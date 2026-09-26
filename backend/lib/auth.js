/**
 * backend/lib/auth.js — PR-2 auth infrastructure
 *
 * Exports (all pure / injectable for testing):
 *   generateNonce(db, localNonces)
 *   consumeNonce(nonce, db, localNonces, now?)
 *   buildSiweMessage(params)
 *   parseSiweMessage(raw)
 *   verifyEoaSignature(body, db, localNonces, allowedDomains, now?)
 *   verifyCircleUserToken(address, userToken, circleApiUrl, circleApiKey, blockchain)
 *   issueJwt(payload, secret, expiresIn?)
 *   verifyJwt(token, secret, prevSecret?)
 *   sanitizeEscrow(escrow, role)   — PR-3 preview, safe to ship now
 *
 * Rules:
 *  - No process.env reads inside functions — callers inject config.
 *  - No side effects at module load time.
 *  - jwt.verify always pins algorithms: ["HS256"].
 */

import crypto from "crypto";
import { ethers } from "ethers";
import jwt from "jsonwebtoken";
import axios from "axios";
import { canViewDocuments, publicDocuments } from "./documents.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Circle API error code → human-readable key. Exported so tests and PR-3
 * frontend can map codes to user-facing messages without duplicating the list.
 *   155103: token not found in system
 *   155104: token expired (60 min TTL)
 *   155105: token invalid / malformed
 */
export const CIRCLE_TOKEN_ERRORS = {
  155103: "not_found",
  155104: "expired",
  155105: "invalid",
};

// ── Legacy shape detection ────────────────────────────────────────────────────

/**
 * Returns true when the /api/wallet/connect request body is the OLD
 * non-SIWE shape (static message, no nonce field, no walletType: circle).
 * These requests are accepted as-is (200, stored, no token issued).
 */
export function isLegacyConnectShape(body) {
  if (!body) return false;
  if (body.walletType === "circle") return false;
  // SIWE messages always have a `nonce` field in the body (sent by the new
  // frontend) or a "Nonce:" line in the message. Legacy messages have neither.
  if (body.nonce) return false;
  if (body.message && /^Nonce:/m.test(body.message)) return false;
  // Legacy body has { address, message, signature, signedAt }
  return Boolean(body.address && body.message && body.signature);
}

// ── Nonce store ──────────────────────────────────────────────────────────────

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generate a single-use nonce and persist it.
 * db       — pg.Pool or null (local-file mode).
 * localNonces — Map<string, { expiresAt: number }> for local-file mode.
 * Returns { nonce, expiresAt } where expiresAt is a Unix timestamp (ms).
 */
export async function generateNonce(db, localNonces, now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = now + NONCE_TTL_MS;

  if (db) {
    await db.query(
      `INSERT INTO proofpay_nonces (nonce, expires_at)
       VALUES ($1, to_timestamp($2 / 1000.0))`,
      [nonce, expiresAt]
    );
    // Lazy cleanup: delete expired rows while we're here.
    await db.query(
      `DELETE FROM proofpay_nonces WHERE expires_at < NOW()`
    ).catch(() => {});
  } else {
    // Lazy cleanup for local-file mode.
    for (const [k, v] of localNonces) {
      if (v.expiresAt < now) localNonces.delete(k);
    }
    localNonces.set(nonce, { expiresAt });
  }

  return { nonce, expiresAt };
}

/**
 * consumeNonceLocal — synchronous, plain-object version for unit tests.
 * store: { [nonce]: expiresAtMs }  (mutated on success — entry deleted)
 * Returns true on first valid use, false on replay/expired/unknown.
 */
export function consumeNonceLocal(store, nonce, now = Date.now()) {
  if (!store || !nonce || !(nonce in store)) return false;
  const expiresAt = store[nonce];
  delete store[nonce];
  return expiresAt > now;
}

/**
 * Consume a nonce: verify it exists, is not expired, then delete it.
 * Returns true on success, false on any failure (unknown, expired, replayed).
 */
export async function consumeNonce(nonce, db, localNonces, now = Date.now()) {
  if (!nonce || typeof nonce !== "string") return false;

  if (db) {
    const result = await db.query(
      `DELETE FROM proofpay_nonces
       WHERE nonce = $1
         AND expires_at > to_timestamp($2 / 1000.0)
       RETURNING nonce`,
      [nonce, now]
    );
    return result.rowCount > 0;
  }

  const entry = localNonces.get(nonce);
  if (!entry) return false;
  localNonces.delete(nonce);
  return entry.expiresAt > now;
}

// ── DB migration (idempotent) ─────────────────────────────────────────────────

/**
 * Ensure the proofpay_nonces table exists. Call from ensureDatabase().
 */
export async function ensureNoncesTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS proofpay_nonces (
      nonce      TEXT PRIMARY KEY,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
}

// ── SIWE message ─────────────────────────────────────────────────────────────

/**
 * Build a SIWE / EIP-4361 style message.
 *
 * params: { domain, address, chainId, nonce, issuedAt?, expirationTime? }
 * issuedAt and expirationTime are ISO-8601 strings; defaults are now and now+2h.
 */
export function buildSiweMessage({
  domain,
  address,
  chainId,
  nonce,
  issuedAt,
  expirationTime,
} = {}) {
  const iat = issuedAt || new Date().toISOString();
  const exp = expirationTime || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to ProofPay. This signature does not create a transaction or charge gas.",
    "",
    `URI: https://${domain}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${nonce}`,
    `Issued At: ${iat}`,
    `Expiration Time: ${exp}`,
  ].join("\n");
}

/**
 * Parse a SIWE message back to its fields.
 * Returns { domain, address, chainId, nonce, issuedAt, expirationTime } or null.
 */
export function parseSiweMessage(raw) {
  if (!raw || typeof raw !== "string") return null;

  try {
    const lines = raw.split("\n");
    const domainMatch = lines[0]?.match(/^(.+?) wants you to sign in/);
    const address = lines[1]?.trim();
    const chainIdMatch = raw.match(/^Chain ID: (.+)$/m);
    const nonceMatch = raw.match(/^Nonce: (.+)$/m);
    const issuedAtMatch = raw.match(/^Issued At: (.+)$/m);
    const expirationMatch = raw.match(/^Expiration Time: (.+)$/m);

    if (!domainMatch || !address || !chainIdMatch || !nonceMatch) return null;

    return {
      domain: domainMatch[1].trim(),
      address: address,
      chainId: Number(chainIdMatch[1].trim()),
      nonce: nonceMatch[1].trim(),
      issuedAt: issuedAtMatch?.[1]?.trim() || null,
      expirationTime: expirationMatch?.[1]?.trim() || null,
    };
  } catch {
    return null;
  }
}

// ── EOA signature verification ───────────────────────────────────────────────

const CHAIN_IDS = { mainnet: 5042, testnet: 5042002 };

/**
 * Verify a SIWE signature from an EOA wallet.
 *
 * Accepts two calling conventions:
 *
 *   A) Server convention (4 positional args + optional now):
 *      verifyEoaSignature(body, db, localNonces, allowedDomains, now?)
 *      body: { address, message, signature }
 *
 *   B) Test-injectable convention (single object):
 *      verifyEoaSignature({ message, signature, address, nonceStore, allowedDomains, now })
 *      nonceStore: plain object { [nonce]: expiresAtMs } (consumeNonceLocal path)
 *
 * Returns { address, network } on success, or { error, code } on failure.
 *   code: "BAD_REQUEST" | "DOMAIN_MISMATCH" | "EXPIRED" | "BAD_NONCE" | "BAD_SIG"
 */
export async function verifyEoaSignature(
  bodyOrTestOptions,
  db,
  localNonces,
  allowedDomains,
  now = Date.now()
) {
  // Detect test-injectable convention: single object with nonceStore key.
  let body, resolvedAllowedDomains, resolvedNow, resolvedDb, resolvedLocalNonces;
  if (bodyOrTestOptions && typeof bodyOrTestOptions === "object" && "nonceStore" in bodyOrTestOptions) {
    const opts = bodyOrTestOptions;
    body = { address: opts.address, message: opts.message, signature: opts.signature };
    resolvedAllowedDomains = opts.allowedDomains;
    resolvedNow = typeof opts.now === "function" ? opts.now() : (opts.now ?? Date.now());
    resolvedDb = null;
    resolvedLocalNonces = opts.nonceStore; // plain object → consumeNonceLocal
  } else {
    body = bodyOrTestOptions;
    resolvedAllowedDomains = allowedDomains;
    resolvedNow = now;
    resolvedDb = db;
    resolvedLocalNonces = localNonces;
  }

  const { address, message, signature } = body || {};

  if (!address || !message || !signature) {
    return { error: "address, message and signature are required.", code: "BAD_REQUEST" };
  }

  const parsed = parseSiweMessage(message);
  if (!parsed) {
    return { error: "not_siwe" };
  }

  // The address written inside the signed message must be the signer's.
  if (parsed.address && parsed.address.toLowerCase() !== String(address).toLowerCase()) {
    return { error: "Message address does not match the wallet address.", code: "BAD_SIG" };
  }

  // Domain check. EIP-4361's domain is the authority and may carry a port
  // (e.g. localhost:5173 in dev); the allowlist holds bare hostnames.
  if (!resolvedAllowedDomains.includes(parsed.domain.replace(/:\d+$/, ""))) {
    return { error: `Domain '${parsed.domain}' is not allowed.`, code: "DOMAIN_MISMATCH" };
  }

  // Expiry check.
  if (parsed.expirationTime && new Date(parsed.expirationTime).getTime() < resolvedNow) {
    return { error: "Message has expired. Request a new sign-in.", code: "EXPIRED" };
  }

  // Nonce check (single-use). Support both plain-object (test) and Map/DB.
  let nonceOk;
  if (resolvedDb === null && resolvedLocalNonces && typeof resolvedLocalNonces === "object" && !("get" in resolvedLocalNonces)) {
    // Plain object store (test convention).
    nonceOk = consumeNonceLocal(resolvedLocalNonces, parsed.nonce, resolvedNow);
  } else {
    nonceOk = await consumeNonce(parsed.nonce, resolvedDb, resolvedLocalNonces, resolvedNow);
  }
  if (!nonceOk) {
    return {
      error: "Nonce is invalid, expired or already used. Request a new sign-in.",
      code: "BAD_NONCE",
    };
  }

  // Signature check.
  let recovered;
  try {
    recovered = ethers.verifyMessage(message, signature);
  } catch {
    return { error: "Signature could not be verified.", code: "BAD_SIG" };
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { error: "Signature does not match the wallet address.", code: "BAD_SIG" };
  }

  // Determine network from chainId.
  const network =
    parsed.chainId === CHAIN_IDS.mainnet
      ? "mainnet"
      : parsed.chainId === CHAIN_IDS.testnet
        ? "testnet"
        : null;

  if (!network) {
    return { error: `Unknown chainId ${parsed.chainId}.`, code: "BAD_REQUEST" };
  }

  return { address: recovered.toLowerCase(), network };
}

// ── Circle userToken verification ─────────────────────────────────────────────

/**
 * Verify a Circle userToken by calling GET /v1/w3s/wallets.
 * Returns { address, network } on success, or { error, code, circleCode } on failure.
 *
 * Circle error codes (from Circle API docs):
 *   155103  HTTP 401  "Cannot find the user token in the system."
 *   155104  HTTP 403  "The userToken had expired."
 *   155105  HTTP 403  "The userToken is invalid."
 *
 * code values:
 *   "CIRCLE_EXPIRED"    — userToken expired (tell user to sign in with email again)
 *   "CIRCLE_INVALID"    — token invalid/not found
 *   "ADDRESS_MISMATCH"  — token valid but no wallet matches claimed address
 *   "CIRCLE_ERROR"      — unexpected Circle API error
 */
/**
 * verifyCircleUserTokenWithFetch — injectable version for tests.
 * fetchWallets: async (userToken) => wallets[]  (mocked in tests)
 * Returns { verified, address, network } on success or { verified: false, message } on failure.
 */
export async function verifyCircleUserTokenWithFetch(
  userToken,
  claimedAddress,
  network,
  fetchWallets
) {
  try {
    const wallets = await fetchWallets(userToken);
    const match = wallets.find(
      (w) => w.address?.toLowerCase() === claimedAddress.toLowerCase()
    );
    if (!match) {
      return { verified: false, message: "No wallet found for this address." };
    }
    return { verified: true, address: match.address.toLowerCase(), network };
  } catch (err) {
    const circleCode = err.response?.data?.code;
    if (circleCode === 155104 || /expired/i.test(err.response?.data?.message || "")) {
      return {
        verified: false,
        message: "Your Circle session has expired. Sign in with email again.",
        code: "CIRCLE_EXPIRED",
      };
    }
    return {
      verified: false,
      message: "Your Circle session is invalid. Sign in with email again.",
      code: "CIRCLE_INVALID",
    };
  }
}

export async function verifyCircleUserToken(
  claimedAddress,
  userToken,
  circleApiUrl,
  circleApiKey,
  blockchain
) {
  if (!userToken || !claimedAddress) {
    return { error: "address and X-User-Token are required.", code: "BAD_REQUEST" };
  }

  let response;
  try {
    response = await axios.get(`${circleApiUrl}/v1/w3s/wallets`, {
      headers: {
        Authorization: `Bearer ${circleApiKey}`,
        "Content-Type": "application/json",
        "X-User-Token": userToken,
      },
      params: { blockchain },
    });
  } catch (err) {
    const status = err.response?.status;
    const circleCode = err.response?.data?.code;
    const circleMessage = err.response?.data?.message || "";

    // 155104: expired, 155105: invalid, 155103: not found
    if (
      status === 403 &&
      (circleCode === 155104 || /expired/i.test(circleMessage))
    ) {
      return {
        error: "Your Circle session has expired. Sign in with email again.",
        code: "CIRCLE_EXPIRED",
        circleCode,
      };
    }

    if (
      status === 401 ||
      status === 403 ||
      circleCode === 155103 ||
      circleCode === 155105
    ) {
      return {
        error: "Your Circle session is invalid. Sign in with email again.",
        code: "CIRCLE_INVALID",
        circleCode,
      };
    }

    return {
      error: "Circle could not verify your wallet. Please try again.",
      code: "CIRCLE_ERROR",
      circleCode,
    };
  }

  // Find a wallet matching the claimed address.
  const wallets = response.data?.data?.wallets || [];
  const match = wallets.find(
    (w) => w.address?.toLowerCase() === claimedAddress.toLowerCase()
  );

  if (!match) {
    return {
      error: "No wallet found for this address. Sign in with email again.",
      code: "ADDRESS_MISMATCH",
    };
  }

  // Determine network from blockchain enum.
  const network =
    match.blockchain === "ARC" || blockchain === "ARC"
      ? "mainnet"
      : "testnet";

  return { address: match.address, network };
}

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_ALGORITHM = "HS256";
const JWT_DEFAULT_EXPIRY = "2h";

/**
 * Issue a JWT.
 * payload: { address, network, isAdmin }
 * secret:  string | null  (if null, returns null — caller must handle)
 * Returns signed token string, or null if secret is missing.
 */
export function issueJwt(payload, secret, expiresIn = JWT_DEFAULT_EXPIRY) {
  if (!secret) return null;
  return jwt.sign(payload, secret, { algorithm: JWT_ALGORITHM, expiresIn });
}

/**
 * Verify a JWT.
 * Tries `secret` first, then `prevSecret` (rotation support).
 * Returns decoded payload, or null on any failure.
 * Always pins algorithm to HS256.
 */
export function verifyJwt(token, secret, prevSecret = null) {
  if (!token || !secret) return null;

  for (const s of [secret, prevSecret].filter(Boolean)) {
    try {
      return jwt.verify(token, s, { algorithms: [JWT_ALGORITHM] });
    } catch {
      // Try next secret.
    }
  }
  return null;
}

// ── Escrow sanitizer (PR-3 preview) ──────────────────────────────────────────

/**
 * Strip fields from an escrow record based on caller identity.
 *
 * callerAddress: string | null  (lowercase wallet address of the caller)
 * adminAddress:  string         (DISPUTE_ADMIN_WALLET, lowercase)
 *
 * Derived role rules:
 *   admin   — callerAddress === adminAddress
 *   seller  — callerAddress === escrow.sellerWallet (lowercase)
 *   buyer   — callerAddress === escrow.buyerWallet  (lowercase)
 *   (none)  — unauthenticated or unrelated address
 *
 * Visibility:
 *   verificationCode — seller only (SellerVerification page shows it)
 *   documents        — the deal's own buyer and seller ONLY (never the admin), public fields only
 *   buyerEmail       — buyer, seller, admin
 *   sellerEmail      — buyer, seller, admin
 *   (never to unauthenticated or unrelated callers)
 *
 * Returns a shallow copy — never mutates the original.
 */
export function sanitizeEscrow(escrow, callerAddress, adminAddress) {
  if (!escrow) return escrow;

  const caller = (callerAddress || "").toLowerCase();
  const admin  = (adminAddress  || "").toLowerCase();
  const buyer  = (escrow.buyerWallet  || "").toLowerCase();
  const seller = (escrow.sellerWallet || "").toLowerCase();

  const isAdmin  = caller && caller === admin;
  const isSeller = caller && caller === seller;
  const isBuyer  = caller && caller === buyer;
  const isParticipant = isBuyer || isSeller || isAdmin;

  const out = { ...escrow };

  // verificationCode: seller only.
  if (!isSeller) {
    delete out.verificationCode;
  }

  // Emails: participants + admin only.
  if (!isParticipant) {
    delete out.buyerEmail;
    delete out.sellerEmail;
  }

  // Deal documents can hold private material: only the deal's own buyer and
  // seller see them (the seller pinned by the buyer counts before they accept).
  // The admin gets none, and neither does anyone else. Parties see public
  // fields only, never the storage path, URL or hash.
  if (canViewDocuments(escrow, callerAddress)) {
    out.documents = publicDocuments(escrow);
  } else {
    delete out.documents;
  }

  return out;
}
