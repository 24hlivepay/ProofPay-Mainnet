/**
 * backend/lib/hardening.js
 *
 * Self-contained security helpers for ProofPay PR-1.
 * Imported by server.js and directly by tests (no Express, no Circle SDK,
 * no env-var validation at import time).
 *
 * Exports:
 *   CHAIN_STATUS           — mirrors ProofPayEscrow.sol Status enum
 *   generateVerificationCode()
 *   makeProvider(network)  — injectable; tests pass a mock
 *   fetchOnChainEscrow(contractAddress, escrowId, network, providerFactory?)
 *   getVerifyState(escrowId, escrow, db?)
 *   incrementVerifyAttempts(escrowId, escrow, allEscrows, db?, saveEscrows?, escrowsCache?, now?)
 *   resetVerifyAttempts(escrowId, escrow, allEscrows, db?, saveEscrows?, escrowsCache?)
 */

import crypto from "node:crypto";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
// On-chain status enum — mirrors ProofPayEscrow.sol
// ---------------------------------------------------------------------------

export const CHAIN_STATUS = Object.freeze({
  NONE:      0,
  FUNDED:    1,
  DELIVERED: 2,
  RELEASED:  3,
  REFUNDED:  4,
  DISPUTED:  5,
});

// ---------------------------------------------------------------------------
// RPC provider
// ---------------------------------------------------------------------------

// arc-studio-allow-onchain-literal
const ARC_RPC_FALLBACK = {
  mainnet: "https://rpc.mainnet.arc.io",       // arc-studio-allow-onchain-literal
  testnet: "https://rpc.testnet.arc.network",  // arc-studio-allow-onchain-literal
};

/**
 * Return an ethers JsonRpcProvider for the given network.
 * Override via ARC_MAINNET_RPC_URL / ARC_TESTNET_RPC_URL env vars.
 * These are the same public URLs used by frontend/src/config/network.js.
 */
export function makeProvider(network) {
  const rpcUrl =
    (network === "mainnet"
      ? process.env.ARC_MAINNET_RPC_URL
      : process.env.ARC_TESTNET_RPC_URL) ||
    ARC_RPC_FALLBACK[network];
  return new ethers.JsonRpcProvider(rpcUrl);
}

// ---------------------------------------------------------------------------
// On-chain escrow lookup
// ---------------------------------------------------------------------------

const ESCROW_ABI_MINIMAL = [
  "function getEscrow(string escrowId) view returns (address buyer, address seller, uint256 amount, uint8 status)",
];

const ONCHAIN_RETRY_DELAYS_MS = [0, 600, 1500];

/**
 * Fetch live on-chain escrow state.
 *
 * @param {string}   contractAddress
 * @param {string}   escrowId
 * @param {string}   network          "mainnet" | "testnet"
 * @param {Function} [providerFactory] Defaults to makeProvider. Pass a mock in tests.
 * @returns {{ buyer, seller, amount: BigInt, status: number } | null}
 *   null = all retries failed (callers must fail-open).
 */
export async function fetchOnChainEscrow(
  contractAddress,
  escrowId,
  network,
  providerFactory = makeProvider
) {
  const provider = providerFactory(network);
  const contract = new ethers.Contract(contractAddress, ESCROW_ABI_MINIMAL, provider);
  let lastErr;

  for (const delay of ONCHAIN_RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    try {
      const result = await contract.getEscrow(escrowId);
      return {
        buyer:  result[0],
        seller: result[1],
        amount: result[2],         // BigInt — 6-decimal USDC/EURC units
        status: Number(result[3]),
      };
    } catch (err) {
      lastErr = err;
    }
  }

  console.error("[ProofPay] fetchOnChainEscrow failed after retries:", escrowId, lastErr?.message);
  return null;
}

// ---------------------------------------------------------------------------
// Verification code generation
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically secure 6-digit verification code string.
 */
export function generateVerificationCode() {
  return crypto.randomInt(100000, 1000000).toString();
}

// ---------------------------------------------------------------------------
// verify-seller attempt / lockout helpers
// ---------------------------------------------------------------------------

export const VERIFY_MAX_ATTEMPTS = 5;
export const VERIFY_LOCKOUT_MS   = 10 * 60 * 1000; // 10 minutes

/**
 * Read current attempt state for an escrow.
 *
 * @param {string} escrowId
 * @param {object} escrow     — current escrow record (for local-file fallback)
 * @param {object} [db]       — pg Pool (or null/undefined for local-file mode)
 * @returns {{ attempts: number, lockedUntil: number|null }}
 */
export async function getVerifyState(escrowId, escrow, db = null) {
  if (db) {
    const result = await db.query(
      "SELECT attempts, locked_until FROM proofpay_verify_attempts WHERE escrow_id = $1",
      [escrowId]
    );
    const row = result.rows[0];
    return {
      attempts:    row?.attempts    ?? 0,
      lockedUntil: row?.locked_until ? new Date(row.locked_until).getTime() : null,
    };
  }
  return {
    attempts:    escrow?.verifyAttempts    ?? 0,
    lockedUntil: escrow?.verifyLockedUntil ?? null,
  };
}

/**
 * Increment the wrong-attempt counter for an escrow.
 *
 * Lockout-expiry fix: if a previous lockout has expired (lockedUntil is in
 * the past), reset attempts to 0 and locked_until to NULL before counting
 * the new attempt. This ensures every 10-minute window allows exactly 5
 * tries; without the reset, attempts stays >= 5 and every guess after expiry
 * immediately re-locks (but see bug: the top-of-handler check passes because
 * Date.now() > lockedUntil, so the reset below is the only safe fix).
 *
 * @param {string}   escrowId
 * @param {object}   escrow        — mutable escrow record
 * @param {Array}    allEscrows    — full escrow list (for local-file save)
 * @param {object}   [db]          — pg Pool or null
 * @param {Function} [saveEscrows] — async fn(allEscrows) for local-file mode
 * @param {object}   [escrowsCache]— in-memory cache object (escrows map)
 * @param {number}   [now]         — injectable clock for tests
 * @returns {{ attempts: number, lockedUntil: number|null }}
 */
export async function incrementVerifyAttempts(
  escrowId,
  escrow,
  allEscrows,
  db          = null,
  saveEscrows = null,
  escrowsCache = null,
  now         = Date.now()
) {
  if (db) {
    // Read current state first so we can detect an expired lockout.
    const current = await getVerifyState(escrowId, escrow, db);

    if (current.lockedUntil !== null && now >= current.lockedUntil) {
      // Previous window expired — reset before counting the new attempt.
      await db.query(
        `UPDATE proofpay_verify_attempts
         SET attempts = 0, locked_until = NULL, updated_at = NOW()
         WHERE escrow_id = $1`,
        [escrowId]
      );
    }

    const result = await db.query(
      `INSERT INTO proofpay_verify_attempts (escrow_id, attempts, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (escrow_id)
       DO UPDATE SET
         attempts   = proofpay_verify_attempts.attempts + 1,
         updated_at = NOW()
       RETURNING attempts, locked_until`,
      [escrowId]
    );
    const { attempts, locked_until } = result.rows[0];

    // Promote to locked when the threshold is just reached and not already locked.
    if (attempts >= VERIFY_MAX_ATTEMPTS && !locked_until) {
      const lockedUntil = new Date(now + VERIFY_LOCKOUT_MS);
      await db.query(
        `UPDATE proofpay_verify_attempts SET locked_until = $1 WHERE escrow_id = $2`,
        [lockedUntil, escrowId]
      );
      return { attempts, lockedUntil: lockedUntil.getTime() };
    }
    return {
      attempts,
      lockedUntil: locked_until ? new Date(locked_until).getTime() : null,
    };
  }

  // Local-file fallback.
  // Lockout-expiry reset: same logic as the DB branch.
  const prevLocked = escrow.verifyLockedUntil ?? null;
  if (prevLocked !== null && now >= prevLocked) {
    escrow.verifyAttempts    = 0;
    escrow.verifyLockedUntil = null;
  }

  escrow.verifyAttempts = (escrow.verifyAttempts ?? 0) + 1;
  if (escrow.verifyAttempts >= VERIFY_MAX_ATTEMPTS && !escrow.verifyLockedUntil) {
    escrow.verifyLockedUntil = now + VERIFY_LOCKOUT_MS;
  }

  if (saveEscrows) {
    const index = allEscrows.findIndex((e) => e.escrowId === escrowId);
    if (index !== -1) { allEscrows[index] = escrow; await saveEscrows(allEscrows); }
  }
  if (escrowsCache) escrowsCache[escrowId] = escrow;

  return {
    attempts:    escrow.verifyAttempts,
    lockedUntil: escrow.verifyLockedUntil ?? null,
  };
}

/**
 * Reset the attempt counter and clear the lockout after a successful verification.
 */
export async function resetVerifyAttempts(
  escrowId,
  escrow,
  allEscrows,
  db           = null,
  saveEscrows  = null,
  escrowsCache = null
) {
  if (db) {
    await db.query(
      `INSERT INTO proofpay_verify_attempts (escrow_id, attempts, updated_at)
       VALUES ($1, 0, NOW())
       ON CONFLICT (escrow_id)
       DO UPDATE SET attempts = 0, locked_until = NULL, updated_at = NOW()`,
      [escrowId]
    );
    return;
  }
  escrow.verifyAttempts    = 0;
  escrow.verifyLockedUntil = null;
  if (saveEscrows) {
    const index = allEscrows.findIndex((e) => e.escrowId === escrowId);
    if (index !== -1) { allEscrows[index] = escrow; await saveEscrows(allEscrows); }
  }
  if (escrowsCache) escrowsCache[escrowId] = escrow;
}
