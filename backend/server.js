import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import pg from "pg";
import { ethers } from "ethers";
import {
  CHAIN_STATUS,
  makeProvider,
  fetchOnChainEscrow,
  generateVerificationCode,
  getVerifyState,
  incrementVerifyAttempts,
  resetVerifyAttempts,
  VERIFY_MAX_ATTEMPTS,
  VERIFY_LOCKOUT_MS,
} from "./lib/hardening.js";
import {
  generateNonce,
  consumeNonce,
  ensureNoncesTable,
  verifyEoaSignature,
  verifyCircleUserToken,
  issueJwt,
  verifyJwt,
  sanitizeEscrow,
} from "./lib/auth.js";
import {
  verifyAdminPassword,
  generateOtp,
  sendOtpEmail,
  getAdminState,
  saveAdminState,
  recordPasswordAttempt,
  isPasswordLocked,
  hasFreshPasswordVerification,
  issueOtpState,
  isOtpLocked,
  isOtpResendCoolingDown,
  recordOtpAttempt,
  logAdminAction,
  getAuditLog,
} from "./lib/adminAuth.js";
import { get as getBlob, put as putBlob } from "@vercel/blob";
import { validateCircleConfig } from "./services/circleService.js";

dotenv.config();

validateCircleConfig();

const app = express();

// Behind Vercel there is one proxy hop; without this req.ip is the proxy's
// address and the /api/auth/nonce rate limit would be shared by all users.
app.set("trust proxy", 1);

// PR-4 note: the *.vercel.app wildcard below is intentionally kept until the
// CORS-hardening PR ships. It will be replaced with a pattern scoped to the
// "proof-pay" Vercel project name (preview URLs use the project name, not the
// repo slug). Production traffic uses same-origin /api calls so CORS only
// matters for localhost dev and Vercel preview branches.
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://proofpay.online",
  "https://www.proofpay.online",
  process.env.FRONTEND_URL,
  // VERCEL_URL is set automatically by Vercel for each deployment
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");

    if (!origin || allowedOrigins.includes(origin) || isVercelPreview) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "12mb" }));

// ---------------------------------------------------------------------------
// PR-3: Auth middleware
//
// requireAuth([role])
//   Fail-closed: if SESSION_SECRET is not set → 503 (never silently skips).
//   Reads Authorization: Bearer <token>, verifies JWT, attaches req.auth.
//   role "admin": additionally re-checks jwt.isAdmin against DISPUTE_ADMIN_WALLET.
//
// tryAuth()
//   Like requireAuth but non-blocking: attaches req.auth if a valid JWT is
//   present, otherwise leaves req.auth = null. Used on endpoints that serve
//   anonymous callers but sanitize differently when authenticated.
// ---------------------------------------------------------------------------

function requireAuth(role) {
  return (req, res, next) => {
    if (!process.env.SESSION_SECRET) {
      return res.status(503).json({ error: "auth not configured", message: "Sign-in is temporarily unavailable. Please try again shortly." });
    }
    const header = req.headers["authorization"] || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "no token", message: "Please connect and sign in with your wallet, then try again." });
    }
    const payload = verifyJwt(token, SESSION_SECRET, SESSION_SECRET_PREV);
    if (!payload) {
      return res.status(401).json({ error: "invalid or expired token", message: "Your session has expired. Please reconnect your wallet and try again." });
    }
    if (role === "admin") {
      const adminWallet = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
      if (!adminWallet || payload.address.toLowerCase() !== adminWallet) {
        return res.status(403).json({ error: "admin only", message: "This action requires admin access." });
      }
    }
    req.auth = payload;
    next();
  };
}

function tryAuth(req, _res, next) {
  req.auth = null;
  if (!process.env.SESSION_SECRET) { next(); return; }
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    req.auth = verifyJwt(token, SESSION_SECRET, SESSION_SECRET_PREV) || null;
  }
  next();
}

// Admin 2FA gate: password + email OTP, checked on top of requireAuth("admin")
// proving wallet ownership. Chain both middlewares: requireAuth("admin"),
// requireFullAdmin. The extra claim is only set on the short-lived JWT
// issued by /api/admin/verify-otp after a fresh password+OTP cycle.
function requireFullAdmin(req, res, next) {
  if (!req.auth?.adminFullyVerified) {
    return res.status(403).json({
      error: "2fa required",
      message: "Complete admin sign-in (password + email code) first.",
    });
  }
  next();
}

const CIRCLE_API_URL = "https://api.circle.com";

// Circle API key, per network — each Arc network has its own Circle
// account/key, so a single global key would silently use the wrong one for
// whichever network it wasn't issued for. CIRCLE_API_KEY keeps its existing
// name for testnet (already set in Vercel); CIRCLE_API_KEY_MAINNET is new.
const CIRCLE_API_KEY_BY_NETWORK = {
  testnet: process.env.CIRCLE_API_KEY,
  mainnet: process.env.CIRCLE_API_KEY_MAINNET,
};

function getCircleHeaders(network) {
  return {
    Authorization: `Bearer ${CIRCLE_API_KEY_BY_NETWORK[network] || ""}`,
    "Content-Type": "application/json",
  };
}

// Arc network the frontend is currently pointed at (see MAINNET_TODO.md
// step 4). frontend/src/services/api.js sends this on every request.
// KNOWN_NETWORKS/getRequestNetwork/escrowNetwork are the single place this
// gets read/normalized — see the note there about pre-launch records.
const KNOWN_NETWORKS = new Set(["mainnet", "testnet"]);

function getRequestNetwork(req) {
  const requested = String(req.get("X-ProofPay-Network") || "").toLowerCase();
  return KNOWN_NETWORKS.has(requested) ? requested : "mainnet";
}

// Every escrow created before 2026-09-16 (the mainnet launch) predates this
// field and has no `network` value. Treat a missing value as testnet, never
// mainnet — old data must never be mistaken for real-money data.
function escrowNetwork(escrow) {
  return KNOWN_NETWORKS.has(escrow?.network) ? escrow.network : "testnet";
}

// Circle Wallets API blockchain enum, per network. Confirmed 2026-09-16
// against developers.circle.com/wallets docs' "Supported blockchains" table
// (mainnet / testnet chain code column: "ARC" / "ARC-TESTNET") — not a
// guess. CIRCLE_MAINNET_BLOCKCHAIN can still override it if Circle ever
// changes the code. See MAINNET_TODO.md step 5.
const CIRCLE_BLOCKCHAIN_BY_NETWORK = {
  testnet: "ARC-TESTNET",
  mainnet: process.env.CIRCLE_MAINNET_BLOCKCHAIN || "ARC",
};

function requireCircleBlockchain(network, res) {
  const blockchain = CIRCLE_BLOCKCHAIN_BY_NETWORK[network];

  if (!blockchain) {
    res.status(501).json({
      success: false,
      message:
        "Circle wallets on Arc Mainnet are not configured yet. Set CIRCLE_MAINNET_BLOCKCHAIN once Circle confirms the mainnet blockchain identifier (see MAINNET_TODO.md, step 5).",
    });
    return null;
  }

  return blockchain;
}

const escrows = {};
const PENDING_ESCROW_EXPIRY_MS = 12 * 60 * 60 * 1000;
const dataDirectory = process.env.DATA_DIR ||
  (process.env.VERCEL
    ? path.join("/tmp", "proofpay-data")
    : path.join(process.cwd(), "data"));
fs.mkdirSync(dataDirectory, { recursive: true });
const dataFile = path.join(dataDirectory, "escrows.json");
const walletConnectionsFile = path.join(dataDirectory, "wallet-connections.json");
const adminStateFile = path.join(dataDirectory, "admin-2fa-state.json");
const adminAuditLogFile = path.join(dataDirectory, "admin-audit-log.json");
const evidenceDirectory = path.join(dataDirectory, "evidence");
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
fs.mkdirSync(evidenceDirectory, { recursive: true });
const databasePool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;
let databaseReady;

// ── Auth config ──────────────────────────────────────────────────────────────
// SESSION_SECRET / SESSION_SECRET_PREV are optional in PR-2. Missing means no
// JWT is issued (200 responses stay the same for legacy callers). PR-3 will
// enforce a token where SESSION_SECRET IS set — separate Production and Preview
// secrets are recommended (set both in Vercel).
const SESSION_SECRET = process.env.SESSION_SECRET || null;
const SESSION_SECRET_PREV = process.env.SESSION_SECRET_PREV || null;

// DISPUTE_ADMIN_WALLET is read from env so it is never committed.
const DISPUTE_ADMIN_WALLET = (
  process.env.DISPUTE_ADMIN_WALLET || ""
).toLowerCase();

// Allowed domains for SIWE message verification.
// hostOf never throws: a malformed env value must not crash the backend at boot.
function hostOf(value) {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname;
  } catch {
    return null;
  }
}

// VERCEL_URL is the per-deployment host; VERCEL_BRANCH_URL is the stable
// branch alias (proof-pay-git-<branch>-...vercel.app) that previews are
// normally opened from, so both must be allowed for testing on previews.
const SIWE_ALLOWED_DOMAINS = [
  "proofpay.online",
  "www.proofpay.online",
  "localhost",
  hostOf(process.env.VERCEL_URL),
  hostOf(process.env.VERCEL_BRANCH_URL),
  hostOf(process.env.VERCEL_PROJECT_PRODUCTION_URL),
  hostOf(process.env.FRONTEND_URL),
].filter(Boolean);

// In-process nonce store for local-file (no DATABASE_URL) mode.
// Vercel serverless: each cold-start gets a fresh Map; nonces that survive
// across cold starts are the Postgres-backed ones. This is acceptable — a
// nonce from a dead instance simply cannot be consumed and the user re-requests.
const localNonces = new Map();

// ── JWT helper (available to all endpoints from PR-3 onwards) ────────────────
/**
 * Extract and verify the Bearer JWT from Authorization header.
 * Returns decoded payload or null. Never throws.
 */
export function extractJwt(req) {
  const auth = req.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  return verifyJwt(token, SESSION_SECRET, SESSION_SECRET_PREV);
}

async function ensureDatabase() {
  if (!databasePool) return;

  if (!databaseReady) {
    databaseReady = (async () => {
      await databasePool.query(`
        CREATE TABLE IF NOT EXISTS proofpay_records (
          record_type TEXT NOT NULL,
          record_id TEXT NOT NULL,
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (record_type, record_id)
        )
      `);
      // PR-1: per-escrow verify-seller attempt counters.
      await databasePool.query(`
        CREATE TABLE IF NOT EXISTS proofpay_verify_attempts (
          escrow_id    TEXT PRIMARY KEY,
          attempts     INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await databasePool.query(`
        ALTER TABLE proofpay_verify_attempts
          ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ
      `);
      // PR-2: single-use nonces for SIWE auth.
      await ensureNoncesTable(databasePool);
    })();
  }

  await databaseReady;
}

// RPC provider, on-chain helpers, CHAIN_STATUS, and verify-seller lockout
// helpers are all imported from ./lib/hardening.js above.
// server.js uses makeProvider as getArcProvider for compatibility.
const getArcProvider = makeProvider;

async function loadEscrows() {
  try {
    let records;

    if (databasePool) {
      await ensureDatabase();
      const result = await databasePool.query(
        "SELECT data FROM proofpay_records WHERE record_type = $1 ORDER BY updated_at ASC",
        ["escrow"]
      );
      records = result.rows.map((row) => row.data);
    } else {
      if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, "[]");
      }
      records = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    }

    if (expirePendingEscrows(records)) {
      await saveEscrows(records);
    }

    return records;

  } catch (error) {

    console.log("Load Error:", error);

    return [];

  }

}

function expirePendingEscrows(records) {
  const now = Date.now();
  let changed = false;

  for (const escrow of records) {
    const isPending =
      escrow.status === "Waiting Seller" ||
      escrow.status === "Seller Accepted";
    const createdAt = Number(escrow.createdAt);

    if (!isPending || !createdAt || now < createdAt + PENDING_ESCROW_EXPIRY_MS) {
      continue;
    }

    escrow.status = "Cancelled";
    escrow.cancellationReason = "Expired after 12 hours";
    escrow.cancelledAt = now;
    escrow.expiresAt = createdAt + PENDING_ESCROW_EXPIRY_MS;
    escrows[escrow.escrowId] = escrow;
    changed = true;
  }

  return changed;
}

async function saveEscrows(data) {
  try {
    if (databasePool) {
      await ensureDatabase();
      const client = await databasePool.connect();

      try {
        await client.query("BEGIN");
        for (const escrow of data) {
          await client.query(
            `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
             VALUES ($1, $2, $3::jsonb, NOW())
             ON CONFLICT (record_type, record_id)
             DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            ["escrow", escrow.escrowId, JSON.stringify(escrow)]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log("❌ SAVE ERROR:", error);
    throw error;
  }
}

function isEscrowParticipant(escrow, wallet) {
  const address = String(wallet || "").toLowerCase();
  return Boolean(address) && [escrow.buyerWallet, escrow.sellerWallet]
    .filter(Boolean)
    .some((participant) => participant.toLowerCase() === address);
}

function participantSide(escrow, wallet) {
  return escrow.buyerWallet?.toLowerCase() === String(wallet || "").toLowerCase()
    ? "buyer"
    : "seller";
}

async function saveEvidenceFiles(escrowId, side, files = []) {
  if (!Array.isArray(files) || files.length > MAX_EVIDENCE_FILES) {
    throw new Error(`Attach up to ${MAX_EVIDENCE_FILES} evidence files.`);
  }
  if (files.length === 0) return [];

  const destination = path.join(evidenceDirectory, escrowId);
  fs.mkdirSync(destination, { recursive: true });

  return Promise.all(files.map(async (file) => {
    if (!ALLOWED_EVIDENCE_TYPES.has(file?.type)) {
      throw new Error("Only JPG, PNG, WEBP, and PDF evidence files are allowed.");
    }
    const match = String(file?.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match || match[1] !== file.type) throw new Error("Invalid evidence upload.");
    const content = Buffer.from(match[2], "base64");
    if (!content.length || content.length > MAX_EVIDENCE_FILE_BYTES) {
      throw new Error("Each evidence file must be 2 MB or smaller.");
    }
    const id = crypto.randomUUID();
    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    let blobUrl = "";
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await putBlob(`disputes/${escrowId}/${side}/${id}.${extension}`, content, {
        access: "private", contentType: file.type, addRandomSuffix: false,
      });
      blobUrl = blob.url;
    } else {
      fs.writeFileSync(path.join(destination, `${id}.${extension}`), content, { flag: "wx" });
    }
    return {
      id,
      side,
      name: String(file.name || `evidence.${extension}`).slice(0, 120),
      type: file.type,
      size: content.length,
      path: `${id}.${extension}`,
      blobUrl,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      uploadedAt: Date.now(),
    };
  }));
}

async function loadWalletConnections() {
  try {
    if (databasePool) {
      await ensureDatabase();
      const result = await databasePool.query(
        "SELECT data FROM proofpay_records WHERE record_type = $1 ORDER BY updated_at ASC",
        ["wallet_connection"]
      );
      return result.rows.map((row) => row.data);
    }

    if (!fs.existsSync(walletConnectionsFile)) {
      fs.writeFileSync(walletConnectionsFile, "[]");
    }

    return JSON.parse(fs.readFileSync(walletConnectionsFile, "utf8"));
  } catch (error) {
    console.log("Wallet connection load error:", error);
    return [];
  }
}

async function saveWalletConnections(connections) {
  if (databasePool) {
    await ensureDatabase();
    for (const connection of connections) {
      await databasePool.query(
        `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (record_type, record_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        ["wallet_connection", connection.address.toLowerCase(), JSON.stringify(connection)]
      );
    }
    return;
  }

  fs.writeFileSync(walletConnectionsFile, JSON.stringify(connections, null, 2));
}

// ── Admin 2FA + audit log local-file helpers (used only without DATABASE_URL) ─
function readAdminStateLocal() {
  try {
    if (!fs.existsSync(adminStateFile)) return null;
    return JSON.parse(fs.readFileSync(adminStateFile, "utf8"));
  } catch {
    return null;
  }
}

function writeAdminStateLocal(state) {
  fs.writeFileSync(adminStateFile, JSON.stringify(state, null, 2));
}

function readAdminAuditLogLocal() {
  try {
    if (!fs.existsSync(adminAuditLogFile)) return [];
    return JSON.parse(fs.readFileSync(adminAuditLogFile, "utf8"));
  } catch {
    return [];
  }
}

function appendAdminAuditLogLocal(entry) {
  const entries = readAdminAuditLogLocal();
  entries.push(entry);
  fs.writeFileSync(adminAuditLogFile, JSON.stringify(entries, null, 2));
}

// ── PR-2: nonce endpoint ─────────────────────────────────────────────────────
// Unauthenticated. Rate-limited to 10 requests per IP per minute via a simple
// in-process counter (acceptable: stateless on Vercel, purpose is friction not
// absolute enforcement; Postgres-backed nonces prevent replay regardless).
const nonceRateMap = new Map(); // ip -> { count, windowStart }
const NONCE_RATE_LIMIT = 10;
const NONCE_RATE_WINDOW_MS = 60 * 1000;

app.get("/api/auth/nonce", async (req, res) => {
  await ensureDatabase();

  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = nonceRateMap.get(ip);

  if (entry && now - entry.windowStart < NONCE_RATE_WINDOW_MS) {
    if (entry.count >= NONCE_RATE_LIMIT) {
      return res.status(429).json({
        success: false,
        message: "Too many nonce requests. Please wait a minute.",
      });
    }
    entry.count += 1;
  } else {
    nonceRateMap.set(ip, { count: 1, windowStart: now });
  }

  try {
    const { nonce, expiresAt } = await generateNonce(databasePool, localNonces);
    return res.json({ nonce, expiresAt });
  } catch (err) {
    console.error("Nonce generation error:", err.message);
    return res.status(500).json({ success: false, message: "Could not generate nonce." });
  }
});

// ── PR-3: wallet/seen — has this address ever appeared in ProofPay? ──────────
// Unauthenticated oracle. Same rate limit as /api/auth/nonce (10 req/IP/min)
// to prevent enumeration of which addresses have used ProofPay.
const seenRateMap = new Map(); // ip -> { count, windowStart }

app.get("/api/wallet/seen", async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const now = Date.now();
  const entry = seenRateMap.get(ip);

  if (entry && now - entry.windowStart < NONCE_RATE_WINDOW_MS) {
    if (entry.count >= NONCE_RATE_LIMIT) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please wait a minute.",
      });
    }
    entry.count += 1;
  } else {
    seenRateMap.set(ip, { count: 1, windowStart: now });
  }

  const address = (req.query.address || "").trim().toLowerCase();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, message: "Invalid address." });
  }

  try {
    const allEscrows = await loadEscrows();
    const seen = allEscrows.some(
      (e) =>
        (e.buyerWallet || "").toLowerCase() === address ||
        (e.sellerWallet || "").toLowerCase() === address
    );
    return res.json({ seen });
  } catch {
    // Fail open — do not block escrow creation if this lookup errors.
    return res.json({ seen: false });
  }
});

// ── PR-2: wallet connect — verify sig, issue JWT ─────────────────────────────
// Three paths:
//   1. SIWE (EOA)        — body has { address, message, signature } where
//                          message parses as a SIWE message (contains "Nonce:").
//   2. Circle wallet     — body has { address, walletType: "circle" } and
//                          X-User-Token header; no signature field.
//   3. Legacy            — any other shape (today's frontend static message).
//                          Accepted as before: 200 { success: true, address },
//                          no token. Backward compatibility preserved.
app.post("/api/wallet/connect", async (req, res) => {
  await ensureDatabase();

  const { address, message, signature, signedAt, walletType } = req.body;

  if (!address) {
    return res.status(400).json({
      success: false,
      message: "Wallet address is required.",
    });
  }

  // ── Path 2: Circle wallet ─────────────────────────────────────────────────
  if (walletType === "circle") {
    const userToken = req.get("X-User-Token");
    const network = getRequestNetwork(req);
    const blockchain = CIRCLE_BLOCKCHAIN_BY_NETWORK[network];

    const result = await verifyCircleUserToken(
      address,
      userToken,
      CIRCLE_API_URL,
      CIRCLE_API_KEY_BY_NETWORK[network] || "",
      blockchain
    );

    if (result.error) {
      const isExpired = result.code === "CIRCLE_EXPIRED";
      return res.status(401).json({
        success: false,
        message: result.error,
        // circleExpired flag lets PR-3 frontend show the right message.
        circleExpired: isExpired,
      });
    }

    const isAdmin = result.address.toLowerCase() === DISPUTE_ADMIN_WALLET;
    const token = issueJwt(
      { address: result.address, network: result.network, isAdmin },
      SESSION_SECRET
    );

    await _storeWalletConnection(address, message || "", signature || "", signedAt || "");
    return res.json({ success: true, address: result.address, ...(token ? { token } : {}) });
  }

  // ── Path 1: SIWE (EOA) ────────────────────────────────────────────────────
  if (message && signature) {
    const result = await verifyEoaSignature(
      { address, message, signature },
      databasePool,
      localNonces,
      SIWE_ALLOWED_DOMAINS
    );

    // "not_siwe" means the message is not a SIWE message — fall through to legacy.
    if (result.error && result.error !== "not_siwe") {
      return res.status(401).json({ success: false, message: result.error });
    }

    if (!result.error) {
      // Valid SIWE — issue token.
      const isAdmin = result.address.toLowerCase() === DISPUTE_ADMIN_WALLET;
      const token = issueJwt(
        { address: result.address, network: result.network, isAdmin },
        SESSION_SECRET
      );
      await _storeWalletConnection(address, message, signature, signedAt || new Date().toISOString());
      return res.json({ success: true, address: result.address, ...(token ? { token } : {}) });
    }
  }

  // ── Path 3: Legacy (static message, no nonce) ─────────────────────────────
  // Accept and store exactly as before — 200, no token.
  if (!message || !signature || !signedAt) {
    return res.status(400).json({
      success: false,
      message: "Wallet address and signature are required.",
    });
  }

  await _storeWalletConnection(address, message, signature, signedAt);
  return res.json({ success: true, address });
});

async function _storeWalletConnection(address, message, signature, signedAt) {
  const connections = await loadWalletConnections();
  const normalizedAddress = address.toLowerCase();
  const connection = {
    address,
    message,
    signature,
    signedAt,
    recordedAt: new Date().toISOString(),
  };
  const existingIndex = connections.findIndex(
    (item) => item.address?.toLowerCase() === normalizedAddress
  );
  if (existingIndex >= 0) {
    connections[existingIndex] = connection;
  } else {
    connections.push(connection);
  }
  await saveWalletConnections(connections);
}


app.post("/api/circle/request-email-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!email || !deviceId) {
      return res.status(400).json({
        success: false,
        message: "Email and Circle device ID are required.",
      });
    }

    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/users/email/token`,
      {
        idempotencyKey: crypto.randomUUID(),
        deviceId,
        email,
      },
      {
        headers: getCircleHeaders(getRequestNetwork(req)),
      }
    );

    return res.json(response.data);

  } catch (error) {
    console.error("Circle email OTP error:", error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Circle could not send the verification code.",
      error: error.response?.data || error.message,
    });
  }
});

app.post("/api/circle/initialize-user", async (req, res) => {

  try {

    const userToken = req.get("X-User-Token");

    if (!userToken) {
      return res.status(400).json({
        success: false,
        message: "User token is required",
      });
    }

    const blockchain = requireCircleBlockchain(getRequestNetwork(req), res);
    if (!blockchain) return;

    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/initialize`,
      {
        idempotencyKey: crypto.randomUUID(),
        accountType: "EOA",
        blockchains: [blockchain],
      },
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);

  } catch (error) {

    console.log(error.response?.data || error);

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });

  }

});

app.get("/api/circle/wallets", async (req, res) => {
  const userToken = req.get("X-User-Token");

  if (!userToken) {
    return res.status(400).json({
      success: false,
      message: "User token is required.",
    });
  }

  const blockchain = requireCircleBlockchain(getRequestNetwork(req), res);
  if (!blockchain) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/wallets`,
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
        params: {
          blockchain,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error("Circle wallet lookup error:", error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Circle could not load the wallet.",
      error: error.response?.data || error.message,
    });
  }
});

const escrowFunctions = new Set([
  "createEscrow(string,address,uint256)",
  "confirmDelivery(string)",
  "releaseFunds(string)",
  "refund(string)",
  "openDispute(string)",
]);
const APPROVE_FUNCTION = new Set(["approve(address,uint256)"]);

// Deployed and on-chain-verified 2026-09-16 — see MAINNET_TODO.md step 2
// for the tx hashes/block numbers. No cirBTC entry: Circle has not
// published a mainnet cirBTC contract (MAINNET_TODO.md step 1).
const ESCROW_ASSETS_BY_NETWORK = {
  mainnet: new Map([
    ["USDC", {
      decimals: 6,
      tokenAddress: "0x3600000000000000000000000000000000000000",
      escrowContractAddress: "0x626B2731A11B39A782992B57ED102012b607BC79",
    }],
    ["EURC", {
      decimals: 6,
      tokenAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      escrowContractAddress: "0xF6f0178e40dbF82D79e7E90a9b07AB0f32b862C0",
    }],
  ]),
  testnet: new Map([
    ["USDC", {
      decimals: 6,
      tokenAddress: "0x3600000000000000000000000000000000000000",
      escrowContractAddress: "0xCd0f43E573899809ff96C560439570A760698C9a",
    }],
    ["EURC", {
      decimals: 6,
      tokenAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      escrowContractAddress: "0xa4322D8ba3E040A3028FD6ABaC3c6a5625ed4ca7",
    }],
    ["cirBTC", {
      decimals: 8,
      tokenAddress: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
      escrowContractAddress: "0x8bfeD6F70Eb595946543b192b6E63d75A0bBEf4B",
    }],
  ]),
};

function getEscrowAssets(network) {
  return ESCROW_ASSETS_BY_NETWORK[network] || ESCROW_ASSETS_BY_NETWORK.testnet;
}

function buildContractAllowlist(assets) {
  const allowlist = new Map();

  for (const asset of assets.values()) {
    allowlist.set(asset.escrowContractAddress.toLowerCase(), escrowFunctions);
    allowlist.set(asset.tokenAddress.toLowerCase(), APPROVE_FUNCTION);
  }

  return allowlist;
}

const CIRCLE_CONTRACT_ALLOWLIST_BY_NETWORK = {
  mainnet: buildContractAllowlist(ESCROW_ASSETS_BY_NETWORK.mainnet),
  testnet: buildContractAllowlist(ESCROW_ASSETS_BY_NETWORK.testnet),
};

function getContractAllowlist(network) {
  return CIRCLE_CONTRACT_ALLOWLIST_BY_NETWORK[network] || CIRCLE_CONTRACT_ALLOWLIST_BY_NETWORK.testnet;
}

function getCircleUserToken(req, res) {
  const userToken = req.get("X-User-Token");

  if (!userToken) {
    res.status(400).json({
      success: false,
      message: "User token is required.",
    });
    return null;
  }

  return userToken;
}

app.post("/api/circle/contract-execution", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.body.walletId || "").trim();
  const contractAddress = String(req.body.contractAddress || "").trim();
  const abiFunctionSignature = String(
    req.body.abiFunctionSignature || ""
  ).trim();
  const abiParameters = req.body.abiParameters;
  const allowedFunctions = getContractAllowlist(getRequestNetwork(req)).get(
    contractAddress.toLowerCase()
  );

  if (
    !walletId ||
    !/^0x[a-fA-F0-9]{40}$/.test(contractAddress) ||
    !allowedFunctions?.has(abiFunctionSignature) ||
    !Array.isArray(abiParameters)
  ) {
    return res.status(400).json({
      success: false,
      message: "This Circle contract operation is not allowed.",
    });
  }

  try {
    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/transactions/contractExecution`,
      {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel: "MEDIUM",
      },
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle contract execution error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not prepare the contract transaction.",
      error: error.response?.data || error.message,
    });
  }
});

app.post("/api/circle/transfer", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.body.walletId || "").trim();
  const destinationAddress = String(
    req.body.destinationAddress || ""
  ).trim();
  const amount = String(req.body.amount || "").trim();
  const tokenId = String(req.body.tokenId || "").trim();

  if (
    !walletId ||
    !/^[a-fA-F0-9-]{36}$/.test(tokenId) ||
    !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress) ||
    // Up to 18 decimals, not 6: this endpoint also handles Arc's native
    // USDC, which CircleWallet.jsx's MAX button formats at 18-decimal
    // precision (its actual on-chain accounting), not the 6 decimals a
    // plain ERC-20 USDC amount would use. A 6-decimal cap here rejected
    // every legitimate MAX-amount native transfer with this exact
    // "invalid amount" message.
    !/^\d+(\.\d{1,18})?$/.test(amount) ||
    Number(amount) <= 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid Arc address and USDC amount.",
    });
  }

  try {
    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/transactions/transfer`,
      {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        destinationAddress,
        amounts: [amount],
        tokenId,
        feeLevel: "MEDIUM",
      },
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle transfer error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not prepare the USDC transfer.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/wallets/:walletId/balances", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/wallets/${encodeURIComponent(
        req.params.walletId
      )}/balances`,
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
        params: {
          includeAll: true,
          pageSize: 50,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle wallet balances error:",
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load wallet balances.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/transactions", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.query.walletId || "").trim();
  if (!walletId) {
    return res.status(400).json({
      success: false,
      message: "Wallet ID is required.",
    });
  }

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/transactions`,
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
        params: {
          walletIds: walletId,
          includeAll: true,
          pageSize: 20,
          order: "DESC",
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle wallet activity error:",
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load wallet activity.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/challenges/:challengeId", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/user/challenges/${encodeURIComponent(
        req.params.challengeId
      )}`,
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load the transaction challenge.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/transactions/:transactionId", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/transactions/${encodeURIComponent(
        req.params.transactionId
      )}`,
      {
        headers: {
          ...getCircleHeaders(getRequestNetwork(req)),
          "X-User-Token": userToken,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load the transaction.",
      error: error.response?.data || error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "ProofPay Backend Running 🚀",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    if (databasePool) {
      await databasePool.query("SELECT 1");
    }

    res.json({
      status: "ok",
      service: "proofpay-backend",
      database: databasePool ? "connected" : "local-file",
      network: getRequestNetwork(req) === "mainnet" ? "Arc Mainnet" : "Arc Testnet",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      service: "proofpay-backend",
      database: "unavailable",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/*
|--------------------------------------------------------------------------
| Create Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow", async (req, res) => {
  const network = getRequestNetwork(req);
  const assetSymbol = req.body.assetSymbol || "USDC";
  const asset = getEscrowAssets(network).get(assetSymbol);

  if (!asset) {
    return res.status(400).json({
      success: false,
      message: network === "mainnet"
        ? "Choose USDC or EURC for this escrow."
        : "Choose USDC, EURC, or cirBTC for this escrow.",
    });
  }

  // PR-3: expectedSeller is required on all new escrows (address-only lock).
  // Existing escrows without it are grandfathered (no schema migration needed).
  const expectedSeller = (req.body.expectedSeller || "").trim().toLowerCase();
  if (!expectedSeller) {
    return res.status(400).json({
      success: false,
      message: "Seller wallet address is required.",
    });
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(expectedSeller)) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid wallet address starting with 0x.",
    });
  }

  // PR-1: crypto-random ID — at least 10 hex chars (~40 bits entropy).
  // Old PP-XXXXXX IDs remain valid; this only affects newly created escrows.
  const escrowId = "PP-" + crypto.randomBytes(5).toString("hex").toUpperCase();

  const escrow = {
    ...req.body,
    network,
    assetSymbol,
    assetDecimals: asset.decimals,
    tokenAddress: asset.tokenAddress,
    escrowContractAddress: asset.escrowContractAddress,
    escrowId,
    expectedSeller,                  // PR-3: normalized to lowercase
    status: "Waiting Seller",
    verificationCode: "",

    isPermanent: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_ESCROW_EXPIRY_MS,
  };

  const allEscrows = await loadEscrows();

  allEscrows.push(escrow);

  await saveEscrows(allEscrows);

  escrows[escrowId] = escrow;
  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Get Escrow
|--------------------------------------------------------------------------
*/

app.get("/api/escrow/:id", tryAuth, async (req, res) => {

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (escrow) {
    escrows[req.params.id] = escrow;
  }

  if (!escrow) {

    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });

  }

  const adminWallet = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  res.json({
    success: true,
    escrow: sanitizeEscrow(escrow, req.auth?.address || null, adminWallet),
  });

});

/*
|--------------------------------------------------------------------------
| Escrow Status
|--------------------------------------------------------------------------
*/

app.get("/api/escrow/:id/status", tryAuth, async (req, res) => {

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (!escrow) {

    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });

  }

  const adminWallet = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  const safe = sanitizeEscrow(escrow, req.auth?.address || null, adminWallet);
  res.json({
    success: true,
    status: escrow.status,
    escrow: safe,
  });

});

/*
|--------------------------------------------------------------------------
| Seller Accept
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/accept", requireAuth(), async (req, res) => {

  const { sellerWallet, sellerName, sellerEmail } = req.body;

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (!sellerWallet) {
    return res.status(400).json({
      success: false,
      message: "Seller wallet is required",
    });
  }

  // PR-3: proof of wallet ownership via JWT-proven identity.
  // New escrows always have expectedSeller set (enforced at creation).
  // Grandfathered escrows (no expectedSeller) fall through to first-to-accept.
  if (escrow.expectedSeller &&
      req.auth.address.toLowerCase() !== escrow.expectedSeller.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "This deal was locked for a different wallet address. It can only be accepted by the seller the buyer specified.",
    });
  }

  // Also verify the claimed sellerWallet body field matches the JWT address
  // (belt-and-suspenders — ensures the DB record is consistent with the token).
  if (sellerWallet && req.auth.address.toLowerCase() !== sellerWallet.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Wallet address does not match your session.",
    });
  }

  if (escrow.status !== "Waiting Seller") {
    return res.status(400).json({
      success: false,
      message: escrow.status === "Cancelled"
        ? "This escrow request expired after 12 hours."
        : "This escrow request is no longer waiting for seller acceptance.",
    });
  }

  escrow.status = "Seller Accepted";
  escrow.sellerWallet = sellerWallet;
  if (sellerName && sellerName.trim()) {
    escrow.sellerName = sellerName.trim();
  }
  if (sellerEmail && sellerEmail.trim()) {
    escrow.sellerEmail = sellerEmail.trim();
  }
  escrow.sellerVerified = false;
  escrow.sellerVerifiedAt = null;
  // PR-1: use crypto.randomInt (was Math.random — not cryptographically random).
  escrow.verificationCode = generateVerificationCode();

  // Keep the in-memory copy in sync with the saved record. The seller
  // verification page reads this copy immediately after acceptance.
  escrows[req.params.id] = escrow;

  await saveEscrows(allEscrows);

  const adminWallet = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  res.json({
    success: true,
    escrow: sanitizeEscrow(escrow, req.auth.address, adminWallet),
  });

});

/*
|--------------------------------------------------------------------------
| Seller Verification
|--------------------------------------------------------------------------
*/

// ---------------------------------------------------------------------------
// verify-seller helpers are imported from ./lib/hardening.js.
// The server passes databasePool, saveEscrows, and escrows (cache) as
// arguments so hardening.js has no direct dependency on server globals.
// ---------------------------------------------------------------------------

app.post("/api/escrow/:id/verify-seller", tryAuth, async (req, res) => {
  const { verificationCode } = req.body || {};
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (escrow.status === "Cancelled") {
    return res.status(400).json({
      success: false,
      message: "This escrow request has been cancelled.",
    });
  }

  if (escrow.sellerVerified) {
    const adminWalletVS = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
    return res.json({ success: true, escrow: sanitizeEscrow(escrow, req.auth?.address || null, adminWalletVS) });
  }

  // PR-1 (v2): check lockout BEFORE evaluating the code so a locked caller
  // cannot probe whether the code changed.
  const state = await getVerifyState(req.params.id, escrow, databasePool);
  if (state.lockedUntil && Date.now() < state.lockedUntil) {
    const retryAfterSec = Math.ceil((state.lockedUntil - Date.now()) / 1000);
    return res
      .status(429)
      .set("Retry-After", String(retryAfterSec))
      .json({
        success: false,
        message:
          "Too many incorrect attempts. Please wait 10 minutes before trying again.",
        retryAfterSeconds: retryAfterSec,
      });
  }

  const submitted = String(verificationCode || "").trim();
  const expected  = String(escrow.verificationCode || "");

  if (!submitted || submitted !== expected) {
    // Increment counter. When the limit is reached, set lockedUntil.
    // Expired lockouts are reset inside incrementVerifyAttempts before
    // counting the new attempt (so each 10-min window allows exactly 5 tries).
    // Code is NOT changed — an unauthenticated caller cannot invalidate a
    // code the seller has already shared.
    const { attempts, lockedUntil } = await incrementVerifyAttempts(
      req.params.id, escrow, allEscrows,
      databasePool, saveEscrows, escrows
    );

    if (lockedUntil) {
      console.warn(
        `[ProofPay] verify-seller: escrow ${req.params.id} locked until ` +
        `${new Date(lockedUntil).toISOString()} after ${attempts} failed attempts.`
      );
      const retryAfterSec = Math.ceil((lockedUntil - Date.now()) / 1000);
      return res
        .status(429)
        .set("Retry-After", String(retryAfterSec))
        .json({
          success: false,
          message:
            "Too many incorrect attempts. Please wait 10 minutes before trying again.",
          retryAfterSeconds: retryAfterSec,
        });
    }

    return res.status(400).json({
      success: false,
      message: "The verification code is incorrect. Please ask the seller to share it again.",
      attemptsRemaining: VERIFY_MAX_ATTEMPTS - attempts,
    });
  }

  escrow.sellerVerified = true;
  escrow.sellerVerifiedAt = Date.now();
  await resetVerifyAttempts(req.params.id, escrow, allEscrows, databasePool, saveEscrows, escrows);

  await saveEscrows(allEscrows);
  escrows[req.params.id] = escrow;

  const adminWalletVS2 = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({
    success: true,
    escrow: sanitizeEscrow(escrow, req.auth?.address || null, adminWalletVS2),
  });
});

/*
|--------------------------------------------------------------------------
| Buyer Deposit
|--------------------------------------------------------------------------
*/


app.post("/api/escrow/:id/deposit", requireAuth(), async (req, res) => {

  const { transactionHash } = req.body || {};

  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (escrow.status === "Cancelled") {
    return res.status(400).json({
      success: false,
      message: "This escrow request expired after 12 hours. Create a new escrow to continue.",
    });
  }

  // PR-3: JWT address must match the buyer wallet on record.
  if (escrow.buyerWallet &&
      req.auth.address.toLowerCase() !== escrow.buyerWallet.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Only the buyer wallet can deposit funds.",
    });
  }

  // PR-1: idempotent recovery path — if the DB update previously failed after
  // a confirmed on-chain deposit, allow a retry when already "Funds Locked".
  const isRecovery = escrow.status === "Funds Locked";

  if (!isRecovery && escrow.status !== "Seller Accepted") {
    return res.status(400).json({
      success: false,
      message: "The seller must accept the deal before you can deposit USDC.",
    });
  }

  if (!isRecovery && !escrow.sellerVerified) {
    return res.status(400).json({
      success: false,
      message: "Verify the seller before depositing USDC.",
    });
  }

  // PR-1: verify on-chain state before trusting this deposit notification.
  // We check buyer, seller, amount, and status — not just the tx hash format.
  // If the RPC is unavailable (provider not configured), we warn and allow
  // through so live mainnet escrows are never silently blocked.
  if (escrow.escrowContractAddress) {
    const network = escrowNetwork(escrow);
    const onChain = await fetchOnChainEscrow(
      escrow.escrowContractAddress,
      escrow.escrowId,
      network
    );

    if (onChain !== null) {
      // On-chain status must be Funded (1) or higher (e.g. Delivered if the
      // seller was very fast) — not None/unfunded.
      if (onChain.status === CHAIN_STATUS.NONE) {
        return res.status(400).json({
          success: false,
          message:
            "The escrow is not funded on-chain yet. Wait for the blockchain " +
            "transaction to confirm, then try again.",
        });
      }

      // Verify the on-chain escrow participants and amount match the DB record.
      const buyerMatch =
        escrow.buyerWallet &&
        onChain.buyer.toLowerCase() === escrow.buyerWallet.toLowerCase();
      const sellerMatch =
        escrow.sellerWallet &&
        onChain.seller.toLowerCase() === escrow.sellerWallet.toLowerCase();

      // Compare amount: DB stores human-readable (e.g. "10.00"), on-chain is
      // in token decimals (e.g. 10_000_000n for USDC 6-decimal). Convert via
      // the asset's decimal count stored on the record.
      const decimals = escrow.assetDecimals ?? 6;
      const expectedUnits = BigInt(
        Math.round(Number(escrow.amount) * 10 ** decimals)
      );
      const amountMatch = onChain.amount === expectedUnits;

      if (!buyerMatch || !sellerMatch || !amountMatch) {
        console.error(
          `[ProofPay] /deposit on-chain mismatch for ${escrow.escrowId}:`,
          {
            buyerMatch,
            sellerMatch,
            amountMatch,
            onChainBuyer: onChain.buyer,
            onChainSeller: onChain.seller,
            onChainAmount: onChain.amount.toString(),
            expectedUnits: expectedUnits.toString(),
          }
        );
        return res.status(400).json({
          success: false,
          message:
            "The on-chain escrow details do not match this order. " +
            "Contact support with your escrow ID.",
        });
      }
    }
  }

  escrow.status = "Funds Locked";
  escrow.isPermanent = true;
  if (!isRecovery) escrow.depositedAt = Date.now();

  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.depositTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {
    allEscrows[index] = escrow;
    await saveEscrows(allEscrows);
  }

  escrows[req.params.id] = escrow;

  const adminWalletDep = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  res.json({
    success: true,
    escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletDep),
  });

});

/*
|--------------------------------------------------------------------------
| Seller Delivery Complete
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/delivered", requireAuth(), async (req, res) => {
  const { transactionHash } = req.body || {};
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  // PR-3: seller identity check — JWT address must match sellerWallet on record.
  if (escrow.sellerWallet &&
      req.auth.address.toLowerCase() !== escrow.sellerWallet.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Only the seller wallet can mark delivery.",
    });
  }

  const adminWalletDlv = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();

  // PR-1: idempotent — if the on-chain tx was confirmed but the DB update
  // was lost (dropped connection, Vercel timeout), a retry must succeed.
  if (escrow.status === "Delivered") {
    // Already marked; update the tx hash if we now have one and return success.
    if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "") && !escrow.deliveryTransactionHash) {
      escrow.deliveryTransactionHash = transactionHash;
      const index = allEscrows.findIndex((e) => e.escrowId === escrow.escrowId);
      if (index !== -1) { allEscrows[index] = escrow; await saveEscrows(allEscrows); }
      escrows[req.params.id] = escrow;
    }
    return res.json({ success: true, escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletDlv) });
  }

  // PR-1 (v2): state check — only "Funds Locked" can transition to "Delivered".
  if (escrow.status !== "Funds Locked") {
    return res.status(400).json({
      success: false,
      message:
        escrow.status === "Cancelled"
          ? "This escrow has been cancelled and cannot be marked as delivered."
          : escrow.status === "Disputed"
          ? "This escrow is under dispute and cannot be marked as delivered."
          : `Cannot mark delivery: escrow status is "${escrow.status}".`,
    });
  }

  // PR-1 (v2): verify on-chain status >= Delivered (2) before accepting the
  // notification. Fail-open when the RPC is unreachable so a node hiccup
  // cannot permanently block an honest seller from completing an escrow.
  if (escrow.escrowContractAddress) {
    const onChain = await fetchOnChainEscrow(
      escrow.escrowContractAddress,
      escrow.escrowId,
      escrowNetwork(escrow)
    );
    if (onChain !== null && onChain.status < CHAIN_STATUS.DELIVERED) {
      return res.status(400).json({
        success: false,
        message:
          "The delivery has not been confirmed on-chain yet. " +
          "Wait for the transaction to be mined and try again.",
      });
    }
  }

  // tx hash is optional: Circle wallets occasionally return an empty string
  // (confirmDelivery returns "" on an idempotent on-chain retry in
  // proofpayContract.js). Store it when present, skip when absent.
  escrow.status = "Delivered";
  escrow.deliveredAt = Date.now();
  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.deliveryTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {
    allEscrows[index] = escrow;
    await saveEscrows(allEscrows);
  }

  escrows[req.params.id] = escrow;

  res.json({
    success: true,
    escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletDlv),
  });

});

/*
|--------------------------------------------------------------------------
| Buyer Release Funds
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/release", requireAuth(), async (req, res) => {

  const { transactionHash } = req.body || {};

  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  // PR-3: JWT address must match the buyer wallet on record.
  if (escrow.buyerWallet &&
      req.auth.address.toLowerCase() !== escrow.buyerWallet.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Only the buyer wallet can release funds.",
    });
  }

  const adminWalletRel = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();

  // PR-1: idempotent — a retry after a dropped DB write must succeed.
  if (escrow.status === "Released") {
    if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "") && !escrow.releaseTransactionHash) {
      escrow.releaseTransactionHash = transactionHash;
      const index = allEscrows.findIndex((e) => e.escrowId === escrow.escrowId);
      if (index !== -1) { allEscrows[index] = escrow; await saveEscrows(allEscrows); }
      escrows[req.params.id] = escrow;
    }
    return res.json({ success: true, escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletRel) });
  }

  if (escrow.status !== "Delivered") {
    return res.status(400).json({
      success: false,
      message: "Seller has not marked the order as Delivered.",
    });
  }

  // PR-1 (v2): verify on-chain status == Released (3) before recording the
  // DB update. Fail-open when the RPC is unreachable so a node hiccup cannot
  // permanently block an honest buyer from completing an escrow.
  if (escrow.escrowContractAddress) {
    const onChain = await fetchOnChainEscrow(
      escrow.escrowContractAddress,
      escrow.escrowId,
      escrowNetwork(escrow)
    );
    if (onChain !== null && onChain.status !== CHAIN_STATUS.RELEASED) {
      return res.status(400).json({
        success: false,
        message:
          "The release has not been confirmed on-chain yet. " +
          "Wait for the transaction to be mined and try again.",
      });
    }
  }

  escrow.status = "Released";
  escrow.releasedAt = Date.now();

  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.releaseTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {

    allEscrows[index] = escrow;

    await saveEscrows(allEscrows);

  }

  res.json({

    success: true,
    escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletRel),

  });

});

/*
|--------------------------------------------------------------------------
| Disputes and private evidence
|--------------------------------------------------------------------------
*/
app.post("/api/escrow/:id/dispute", requireAuth(), async (req, res) => {
  try {
    const { reason, statement, files, transactionHash } = req.body || {};
    const wallet = req.auth.address; // PR-3: use JWT address, not body field
    const allEscrows = await loadEscrows();
    const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
    if (!escrow) return res.status(404).json({ success: false, message: "Escrow Not Found" });
    if (!isEscrowParticipant(escrow, wallet)) return res.status(403).json({ success: false, message: "Only the buyer or seller can open this dispute." });
    if (!["Funds Locked", "Delivered"].includes(escrow.status)) {
      return res.status(400).json({ success: false, message: "Only funded escrows can be disputed." });
    }
    if (!String(reason || "").trim() || !String(statement || "").trim()) {
      return res.status(400).json({ success: false, message: "A dispute reason and explanation are required." });
    }

    const side = participantSide(escrow, wallet);
    const evidence = await saveEvidenceFiles(escrow.escrowId, side, files);
    escrow.status = "Disputed";
    escrow.dispute = {
      id: crypto.randomUUID(),
      openedBy: wallet.toLowerCase(),
      openedBySide: side,
      reason: String(reason).trim().slice(0, 120),
      statement: String(statement).trim().slice(0, 4000),
      openedAt: Date.now(),
      responseDueAt: Date.now() + 48 * 60 * 60 * 1000,
      status: "Awaiting response",
      openTransactionHash: /^0x[a-fA-F0-9]{64}$/.test(transactionHash || "") ? transactionHash : "",
      evidence,
      responses: [],
    };
    await saveEscrows(allEscrows);
    escrows[escrow.escrowId] = escrow;
    const adminWalletDsp = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
    return res.json({ success: true, escrow: sanitizeEscrow(escrow, wallet, adminWalletDsp) });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to open dispute." });
  }
});

app.post("/api/escrow/:id/dispute/response", requireAuth(), async (req, res) => {
  try {
    const { statement, files } = req.body || {};
    const wallet = req.auth.address; // PR-3: use JWT address
    const allEscrows = await loadEscrows();
    const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
    if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });
    if (!isEscrowParticipant(escrow, wallet)) return res.status(403).json({ success: false, message: "Only escrow participants can respond." });
    const side = participantSide(escrow, wallet);
    if (side === escrow.dispute.openedBySide) return res.status(400).json({ success: false, message: "Wait for the other party's response before adding more evidence." });
    if (!String(statement || "").trim()) return res.status(400).json({ success: false, message: "A written response is required." });
    const evidence = await saveEvidenceFiles(escrow.escrowId, side, files);
    escrow.dispute.responses.push({ side, wallet: wallet.toLowerCase(), statement: String(statement).trim().slice(0, 4000), submittedAt: Date.now(), evidence });
    escrow.dispute.status = "Under review";
    await saveEscrows(allEscrows);
    const adminWalletDsr = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
    return res.json({ success: true, escrow: sanitizeEscrow(escrow, wallet, adminWalletDsr) });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to submit response." });
  }
});

const MAX_DISPUTE_MESSAGES = 200;

function addDisputeMessage(escrow, from, wallet, text) {
  const clean = String(text || "").trim().slice(0, 2000);
  if (!clean) return false;
  escrow.dispute.messages = escrow.dispute.messages || [];
  if (escrow.dispute.messages.length >= MAX_DISPUTE_MESSAGES) return false;
  escrow.dispute.messages.push({
    from,
    wallet: String(wallet).toLowerCase(),
    text: clean,
    sentAt: Date.now(),
  });
  return true;
}

app.post("/api/escrow/:id/dispute/message", requireAuth(), async (req, res) => {
  const { text } = req.body || {};
  const wallet = req.auth.address; // PR-3: use JWT address
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });
  if (!isEscrowParticipant(escrow, wallet)) return res.status(403).json({ success: false, message: "Only escrow participants can send messages." });
  if (!addDisputeMessage(escrow, participantSide(escrow, wallet), wallet, text)) return res.status(400).json({ success: false, message: "Write a message first." });
  await saveEscrows(allEscrows);
  const adminWalletDsm = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({ success: true, escrow: sanitizeEscrow(escrow, wallet, adminWalletDsm) });
});

app.post("/api/admin/disputes/:id/message", requireAuth("admin"), requireFullAdmin, async (req, res) => {
  const { text } = req.body || {};
  const wallet = req.auth.address; // PR-3: use JWT address (admin re-checked by requireAuth)
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });
  if (!addDisputeMessage(escrow, "admin", wallet, text)) return res.status(400).json({ success: false, message: "Write a message first." });
  await saveEscrows(allEscrows);
  await logAdminAction(
    databasePool,
    { adminWallet: wallet, action: "dispute.message", escrowId: escrow.escrowId, details: { textLength: String(text || "").length } },
    appendAdminAuditLogLocal
  );
  const adminWalletAdm = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({ success: true, escrow: sanitizeEscrow(escrow, wallet, adminWalletAdm) });
});

app.get("/api/escrow/:id/dispute", requireAuth(), async (req, res) => {
  const wallet = req.auth.address; // PR-3: use JWT address
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute) return res.status(404).json({ success: false, message: "Dispute not found." });
  const adminWalletDspG = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  const isAdmin = wallet.toLowerCase() === adminWalletDspG;
  if (!isEscrowParticipant(escrow, wallet) && !isAdmin) return res.status(403).json({ success: false, message: "This case is private." });
  return res.json({ success: true, dispute: escrow.dispute, escrow: sanitizeEscrow(escrow, wallet, adminWalletDspG) });
});

app.get("/api/escrow/:id/dispute/evidence/:fileId", requireAuth(), async (req, res) => {
  const wallet = req.auth.address; // PR-3: use JWT address
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || (!isEscrowParticipant(escrow, wallet) && !isDisputeAdmin(wallet))) return res.sendStatus(403);
  const entries = [...escrow.dispute.evidence, ...escrow.dispute.responses.flatMap((response) => response.evidence || [])];
  const file = entries.find((entry) => entry.id === req.params.fileId);
  if (!file) return res.sendStatus(404);
  if (file.blobUrl) {
    const blob = await getBlob(file.blobUrl, { access: "private" });
    if (!blob?.stream) return res.sendStatus(404);
    const content = Buffer.from(await new Response(blob.stream).arrayBuffer());
    return res.type(file.type).send(content);
  }
  return res.type(file.type).sendFile(path.resolve(evidenceDirectory, escrow.escrowId, file.path));
});

function isDisputeAdmin(wallet) {
  const configured = String(process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return Boolean(configured) && configured === String(wallet || "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Admin 2FA: password + email OTP, on top of requireAuth("admin") (wallet
// proof). Every step here still requires a valid admin-wallet JWT -- this is
// a second factor, not a replacement for wallet auth.
// ---------------------------------------------------------------------------

async function loadAdminState() {
  return getAdminState(databasePool, readAdminStateLocal());
}

async function persistAdminState(state) {
  await saveAdminState(databasePool, state, writeAdminStateLocal);
}

app.post("/api/admin/verify-password", requireAuth("admin"), async (req, res) => {
  const { password } = req.body || {};
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    return res.status(503).json({ success: false, message: "Admin sign-in is not fully configured yet." });
  }

  const state = await loadAdminState();
  if (isPasswordLocked(state)) {
    return res.status(429).json({
      success: false,
      message: "Too many wrong attempts. Try again in a few minutes.",
    });
  }

  const ok = await verifyAdminPassword(password, hash);
  const nextState = recordPasswordAttempt(state, ok);
  await persistAdminState(nextState);

  if (!ok) {
    return res.status(401).json({ success: false, message: "Incorrect password." });
  }
  return res.json({ success: true });
});

app.post("/api/admin/send-otp", requireAuth("admin"), async (req, res) => {
  const resendKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!resendKey || !adminEmail) {
    return res.status(503).json({ success: false, message: "Admin sign-in is not fully configured yet." });
  }

  const state = await loadAdminState();
  if (!hasFreshPasswordVerification(state)) {
    return res.status(403).json({ success: false, message: "Verify your password again first." });
  }
  if (isOtpResendCoolingDown(state)) {
    return res.status(429).json({ success: false, message: "Wait a moment before requesting another code." });
  }

  const otp = generateOtp();
  const nextState = issueOtpState(state, otp);

  try {
    await sendOtpEmail(otp, { apiKey: resendKey, toEmail: adminEmail });
  } catch (err) {
    console.error("[ProofPay] admin OTP email failed:", err?.message);
    return res.status(502).json({ success: false, message: "Could not send the code. Try again shortly." });
  }

  await persistAdminState(nextState);
  return res.json({ success: true, message: "Code sent." });
});

app.post("/api/admin/verify-otp", requireAuth("admin"), async (req, res) => {
  const { otp } = req.body || {};
  const state = await loadAdminState();

  if (isOtpLocked(state)) {
    return res.status(429).json({ success: false, message: "Too many wrong codes. Try again in a few minutes." });
  }

  const { ok, state: nextState, expired } = recordOtpAttempt(state, otp);
  await persistAdminState(nextState);

  if (!ok) {
    return res.status(401).json({
      success: false,
      message: expired ? "That code expired. Request a new one." : "Incorrect code.",
    });
  }

  const token = issueJwt(
    { address: req.auth.address, network: req.auth.network, isAdmin: true, adminFullyVerified: true },
    SESSION_SECRET,
    "1h"
  );
  return res.json({ success: true, token });
});

// Shared with GET /api/escrows below -- the same grouping buyers/sellers see
// on their own dashboards, so "Active" means the same thing for admin too.
const ESCROW_STATUS_CATEGORIES = {
  pending: ["Waiting Seller", "Seller Accepted"],
  active: ["Funds Locked", "Delivered", "Disputed"],
  completed: ["Released", "Refunded"],
  cancelled: ["Cancelled"],
};

app.get("/api/admin/escrows", requireAuth("admin"), requireFullAdmin, async (req, res) => {
  const network = getRequestNetwork(req);
  const { search = "", status = "", category = "" } = req.query;
  const allEscrows = await loadEscrows();
  const normalizedSearch = String(search).trim().toLowerCase();

  let filtered = allEscrows.filter((escrow) => escrowNetwork(escrow) === network);
  if (category && ESCROW_STATUS_CATEGORIES[category]) {
    filtered = filtered.filter((escrow) => ESCROW_STATUS_CATEGORIES[category].includes(escrow.status));
  } else if (status) {
    filtered = filtered.filter((escrow) => escrow.status === status);
  }
  if (normalizedSearch) {
    filtered = filtered.filter((escrow) =>
      escrow.escrowId?.toLowerCase().includes(normalizedSearch) ||
      escrow.buyerWallet?.toLowerCase().includes(normalizedSearch) ||
      escrow.sellerWallet?.toLowerCase().includes(normalizedSearch) ||
      escrow.buyerName?.toLowerCase().includes(normalizedSearch) ||
      escrow.sellerName?.toLowerCase().includes(normalizedSearch)
    );
  }

  filtered = filtered.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 200);
  const adminWalletEsc = req.auth.address.toLowerCase();
  return res.json({
    success: true,
    escrows: filtered.map((e) => sanitizeEscrow(e, adminWalletEsc, adminWalletEsc)),
  });
});

app.get("/api/admin/audit-log", requireAuth("admin"), requireFullAdmin, async (req, res) => {
  const { escrowId, limit } = req.query;
  const entries = await getAuditLog(
    databasePool,
    { limit: Number(limit) || 100, escrowId: escrowId || undefined },
    readAdminAuditLogLocal()
  );
  return res.json({ success: true, entries });
});

app.get("/api/admin/disputes", requireAuth("admin"), requireFullAdmin, async (req, res) => {
  // PR-3: admin re-checked by requireAuth("admin"); body wallet field removed.
  const network = getRequestNetwork(req);
  const allEscrows = await loadEscrows();
  const withDispute = allEscrows.filter((escrow) => escrow.dispute && escrowNetwork(escrow) === network);
  const adminWalletAdmG = req.auth.address.toLowerCase();
  return res.json({
    success: true,
    disputes: withDispute
      .filter((escrow) => escrow.status === "Disputed")
      .map((e) => sanitizeEscrow(e, adminWalletAdmG, adminWalletAdmG)),
    resolved: withDispute
      .filter((escrow) => escrow.dispute.resolution)
      .sort((a, b) => b.dispute.resolution.resolvedAt - a.dispute.resolution.resolvedAt)
      .map((e) => sanitizeEscrow(e, adminWalletAdmG, adminWalletAdmG)),
  });
});

app.post("/api/admin/disputes/:id/resolved", requireAuth("admin"), requireFullAdmin, async (req, res) => {
  const { buyerAmount, transactionHash, note } = req.body || {};
  const wallet = req.auth.address; // PR-3: use JWT address
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) return res.status(400).json({ success: false, message: "A confirmed on-chain resolution transaction is required." });

  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });

  // PR-1: three on-chain checks before recording the resolution.
  //   1. tx.from must be DISPUTE_ADMIN_WALLET
  //   2. tx.to must be the escrow contract
  //   3. getEscrow() status must be Released (3) or Refunded (4)
  //
  // Fail-open when the RPC node is unreachable (null tx / null onChain) so
  // an RPC outage cannot permanently block admin from resolving a dispute.
  const network = escrowNetwork(escrow);
  const provider = getArcProvider(network);

  let tx = null;
  try {
    tx = await provider.getTransaction(transactionHash);
  } catch (rpcErr) {
    console.error("[ProofPay] /resolved: getTransaction failed:", rpcErr?.message);
  }

  if (tx !== null) {
    const adminWallet = String(process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
    if (adminWallet && tx.from.toLowerCase() !== adminWallet) {
      return res.status(400).json({
        success: false,
        message: "The transaction was not sent from the ProofPay admin wallet.",
      });
    }

    if (
      escrow.escrowContractAddress &&
      tx.to?.toLowerCase() !== escrow.escrowContractAddress.toLowerCase()
    ) {
      return res.status(400).json({
        success: false,
        message: "The transaction was not sent to the correct escrow contract.",
      });
    }
  }

  const onChain = await fetchOnChainEscrow(
    escrow.escrowContractAddress,
    escrow.escrowId,
    network
  );

  if (onChain !== null) {
    const terminalStatuses = [CHAIN_STATUS.RELEASED, CHAIN_STATUS.REFUNDED];
    if (!terminalStatuses.includes(onChain.status)) {
      return res.status(400).json({
        success: false,
        message:
          "The escrow is not yet resolved on-chain. " +
          "Wait for the resolveDispute() transaction to confirm and try again.",
      });
    }
  }

  escrow.status = Number(buyerAmount) >= Number(escrow.amount) ? "Refunded" : "Released";
  escrow.dispute.status = "Resolved";
  escrow.dispute.resolution = {
    buyerAmount: String(buyerAmount),
    sellerAmount: String(Number(escrow.amount) - Number(buyerAmount)),
    transactionHash,
    note: String(note || "").trim().slice(0, 2000),
    resolvedAt: Date.now(),
    resolvedBy: String(wallet).toLowerCase(),
  };
  await saveEscrows(allEscrows);
  await logAdminAction(
    databasePool,
    {
      adminWallet: wallet,
      action: "dispute.resolved",
      escrowId: escrow.escrowId,
      details: { buyerAmount: String(buyerAmount), sellerAmount: escrow.dispute.resolution.sellerAmount, transactionHash },
    },
    appendAdminAuditLogLocal
  );
  const adminWalletRes = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({ success: true, escrow: sanitizeEscrow(escrow, wallet, adminWalletRes) });
});

/*
|--------------------------------------------------------------------------
| Cancel Pending Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/cancel", requireAuth(), async (req, res) => {
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (
    escrow.status !== "Waiting Seller" &&
    escrow.status !== "Seller Accepted"
  ) {
    return res.status(400).json({
      success: false,
      message: "Only an escrow that has not been funded can be cancelled.",
    });
  }

  // PR-3: use JWT address instead of body buyerWallet
  if (escrow.buyerWallet &&
      req.auth.address.toLowerCase() !== escrow.buyerWallet.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "Only the buyer wallet can cancel this escrow.",
    });
  }

  escrow.status = "Cancelled";
  escrow.cancellationReason = "Cancelled by Buyer";
  escrow.cancelledAt = Date.now();
  escrows[req.params.id] = escrow;
  await saveEscrows(allEscrows);

  const adminWalletCan = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({ success: true, escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletCan) });
});

/*
|--------------------------------------------------------------------------
| Seller Reject Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/reject", requireAuth(), async (req, res) => {
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({ success: false, message: "Escrow Not Found" });
  }

  if (escrow.status !== "Waiting Seller" && escrow.status !== "Seller Accepted") {
    return res.status(400).json({
      success: false,
      message: "This escrow can no longer be rejected.",
    });
  }

  // PR-3: if the escrow is locked to a specific seller, only that wallet can
  // reject it. An authenticated-but-wrong wallet must not be able to reject
  // someone else's locked deal.
  if (escrow.expectedSeller &&
      req.auth.address.toLowerCase() !== escrow.expectedSeller.toLowerCase()) {
    return res.status(403).json({
      success: false,
      message: "This deal was locked for a different wallet address.",
    });
  }

  escrow.status = "Cancelled";
  escrow.cancellationReason = "Rejected by Seller";
  // PR-3: JWT address is the proof of ownership; keep existing sellerWallet if set
  escrow.sellerWallet = req.auth.address || escrow.sellerWallet || "";
  escrow.cancelledAt = Date.now();
  escrows[req.params.id] = escrow;
  await saveEscrows(allEscrows);

  const adminWalletRej = (process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return res.json({ success: true, escrow: sanitizeEscrow(escrow, req.auth.address, adminWalletRej) });
});

/*
|--------------------------------------------------------------------------
| Get Active Escrows
|--------------------------------------------------------------------------
*/

app.get("/api/escrows", async (req, res) => {

  const network = getRequestNetwork(req);
  const allEscrows = await loadEscrows();

  const { category, buyerWallet, wallet, role } = req.query;
  const allowedStatuses = ESCROW_STATUS_CATEGORIES[category] || ESCROW_STATUS_CATEGORIES.active;
  const connectedWallet = (wallet || buyerWallet || "").toLowerCase();
  const recordRole = role === "seller" ? "seller" : "buyer";

  const activeEscrows = allEscrows.filter((escrow) => {
    if (escrowNetwork(escrow) !== network) return false;

    const belongsToConnectedWallet = !connectedWallet || (
      recordRole === "seller"
        ? escrow.sellerWallet?.toLowerCase() === connectedWallet
        : escrow.buyerWallet?.toLowerCase() === connectedWallet
    );

    if (!belongsToConnectedWallet) return false;
    if (category === "disputes") return Boolean(escrow.dispute);
    return allowedStatuses.includes(escrow.status);
  });

  res.json({
    success: true,
    escrows: activeEscrows,
  });

});

/*
|--------------------------------------------------------------------------
| ProofPay Live Escrow Overview
|--------------------------------------------------------------------------
*/

app.get("/api/escrow-stats", async (req, res) => {
  const network = getRequestNetwork(req);
  const allEscrowsRaw = await loadEscrows();
  const allEscrows = allEscrowsRaw.filter((escrow) => escrowNetwork(escrow) === network);
  const assets = getEscrowAssets(network);
  const lockedEscrows = allEscrows.filter(
    (escrow) => escrow.status === "Funds Locked" || escrow.status === "Delivered"
  );
  const executedEscrows = allEscrows.filter((escrow) =>
    ["Funds Locked", "Delivered", "Released"].includes(escrow.status)
  ).length;

  const lockedByAsset = lockedEscrows.reduce((totals, escrow) => {
    const symbol = assets.has(escrow.assetSymbol) ? escrow.assetSymbol : "USDC";
    totals[symbol] += Number(escrow.amount) || 0;
    return totals;
  }, { USDC: 0, EURC: 0, cirBTC: 0 });
  const activeBuyers = new Set(
    allEscrows.map((escrow) => escrow.buyerWallet?.toLowerCase()).filter(Boolean)
  ).size;
  const activeSellers = new Set(
    allEscrows.map((escrow) => escrow.sellerWallet?.toLowerCase()).filter(Boolean)
  ).size;

  return res.json({
    success: true,
    lockedByAsset,
    executedEscrows,
    liveEscrows: allEscrows.length,
    activeBuyers,
    activeSellers,
  });
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT) || 5001;

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {

    console.log(
      `✅ ProofPay Backend Running on http://localhost:${PORT}`
    );

  });
}

export default app;
