/**
 * backend/lib/adminAuth.js
 *
 * Second-factor admin verification: password + email OTP, on top of the
 * wallet-proven JWT from requireAuth("admin"). Self-contained (no Express),
 * imported by server.js and directly by tests.
 *
 * State model: a single record (there is exactly one admin wallet) with
 * independent lockout windows for the password step and the OTP step, plus
 * the OTP itself (hashed, short-lived, single-use).
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";

export const PASSWORD_MAX_ATTEMPTS = 5;
export const PASSWORD_LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
export const PASSWORD_VALID_WINDOW_MS = 10 * 60 * 1000; // must request OTP within 10 min of password success

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCKOUT_MS = 10 * 60 * 1000;
export const OTP_EXPIRY_MS = 5 * 60 * 1000;
export const OTP_RESEND_COOLDOWN_MS = 30 * 1000;

const DEFAULT_STATE = Object.freeze({
  passwordAttempts: 0,
  passwordLockedUntil: null,
  passwordVerifiedAt: null,
  otpHash: null,
  otpExpiresAt: null,
  otpAttempts: 0,
  otpLockedUntil: null,
  otpSentAt: null,
});

/**
 * Verify a plaintext password against the configured bcrypt hash.
 * Returns false (never throws) if the hash env var is missing or malformed.
 */
export async function verifyAdminPassword(password, hash) {
  if (!password || !hash) return false;
  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

export function hashOtp(otp) {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

/**
 * Send the OTP email via the Resend HTTP API (no SDK dependency).
 * Throws on any non-2xx response so callers can distinguish "email did not
 * send" from "OTP stored" and avoid telling the admin a code is on its way
 * when it never left the server.
 */
export async function sendOtpEmail(otp, { apiKey, toEmail, fromEmail, fetchImpl = fetch }) {
  return sendAdminEmail(
    {
      subject: `ProofPay admin login code: ${otp}`,
      text: `Your ProofPay admin verification code is ${otp}. It expires in 5 minutes. If you did not request this, someone may have your admin password -- rotate it immediately.`,
    },
    { apiKey, toEmail, fromEmail, fetchImpl }
  );
}

/** Plain-text email to the admin inbox via Resend. Throws on non-2xx. */
export async function sendAdminEmail(
  { subject, text },
  { apiKey, toEmail, fromEmail = "ProofPay Admin <noreply@proofpay.online>", fetchImpl = fetch }
) {
  const res = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: fromEmail, to: [toEmail], subject, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend API error ${res.status}: ${body.slice(0, 200)}`);
  }
}

const oneLine = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Subject/body for the "a dispute was opened" alert. Deliberately excludes
 * the user's full statement and evidence (those stay behind admin sign-in);
 * plain text only, so user-supplied text cannot inject markup.
 */
export function buildDisputeAlertEmail(escrow, adminUrl) {
  const d = escrow.dispute || {};
  return {
    subject: `ProofPay dispute opened: ${oneLine(escrow.escrowId, 30)} (${oneLine(escrow.amount, 20)} ${oneLine(escrow.assetSymbol || "USDC", 10)})`,
    text: [
      "A dispute was just opened on ProofPay.",
      "",
      `Escrow: ${oneLine(escrow.escrowId, 30)}`,
      `Amount: ${oneLine(escrow.amount, 20)} ${oneLine(escrow.assetSymbol || "USDC", 10)}`,
      `Network: ${oneLine(escrow.network || "", 10)}`,
      `Opened by: ${oneLine(d.openedBySide, 10)}`,
      `Reason: ${oneLine(d.reason, 120)}`,
      "",
      `Review it (admin sign-in required): ${adminUrl}`,
    ].join("\n"),
  };
}

// ---------------------------------------------------------------------------
// State storage — Postgres (proofpay_records, record_type="admin_2fa") or a
// local JSON file, mirroring the pattern in server.js for wallet_connection.
// ---------------------------------------------------------------------------

const RECORD_TYPE = "admin_2fa";
const RECORD_ID = "state";

export async function getAdminState(db, localState) {
  if (db) {
    const result = await db.query(
      "SELECT data FROM proofpay_records WHERE record_type = $1 AND record_id = $2",
      [RECORD_TYPE, RECORD_ID]
    );
    return result.rows[0]?.data ?? { ...DEFAULT_STATE };
  }
  return { ...DEFAULT_STATE, ...(localState || {}) };
}

export async function saveAdminState(db, state, setLocalState) {
  if (db) {
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (record_type, record_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [RECORD_TYPE, RECORD_ID, JSON.stringify(state)]
    );
    return;
  }
  if (setLocalState) setLocalState(state);
}

/**
 * Record a password attempt. Resets an expired lockout before counting.
 * Returns the updated state.
 */
export function recordPasswordAttempt(state, success, now = Date.now()) {
  const next = { ...state };
  if (next.passwordLockedUntil !== null && now >= next.passwordLockedUntil) {
    next.passwordAttempts = 0;
    next.passwordLockedUntil = null;
  }
  if (success) {
    next.passwordAttempts = 0;
    next.passwordLockedUntil = null;
    next.passwordVerifiedAt = now;
    return next;
  }
  next.passwordAttempts += 1;
  if (next.passwordAttempts >= PASSWORD_MAX_ATTEMPTS && !next.passwordLockedUntil) {
    next.passwordLockedUntil = now + PASSWORD_LOCKOUT_MS;
  }
  return next;
}

export function isPasswordLocked(state, now = Date.now()) {
  return Boolean(state.passwordLockedUntil && now < state.passwordLockedUntil);
}

/** True if a password success is still within the window to request an OTP. */
export function hasFreshPasswordVerification(state, now = Date.now()) {
  return Boolean(state.passwordVerifiedAt && now - state.passwordVerifiedAt < PASSWORD_VALID_WINDOW_MS);
}

export function issueOtpState(state, otp, now = Date.now()) {
  return {
    ...state,
    otpHash: hashOtp(otp),
    otpExpiresAt: now + OTP_EXPIRY_MS,
    otpAttempts: 0,
    otpLockedUntil: null,
    otpSentAt: now,
  };
}

export function isOtpLocked(state, now = Date.now()) {
  return Boolean(state.otpLockedUntil && now < state.otpLockedUntil);
}

export function isOtpResendCoolingDown(state, now = Date.now()) {
  return Boolean(state.otpSentAt && now - state.otpSentAt < OTP_RESEND_COOLDOWN_MS);
}

/**
 * Verify a submitted OTP against stored state. Resets an expired lockout
 * before counting. Returns { ok, state } — state is always the next state
 * to persist.
 */
export function recordOtpAttempt(state, submittedOtp, now = Date.now()) {
  let next = { ...state };
  if (next.otpLockedUntil !== null && now >= next.otpLockedUntil) {
    next.otpAttempts = 0;
    next.otpLockedUntil = null;
  }

  const expired = !next.otpHash || !next.otpExpiresAt || now >= next.otpExpiresAt;
  const matches = !expired && next.otpHash === hashOtp(String(submittedOtp || ""));

  if (matches) {
    next.otpHash = null;
    next.otpExpiresAt = null;
    next.otpAttempts = 0;
    next.otpLockedUntil = null;
    // Password verification is single-use per OTP cycle -- clear it so a
    // fresh password entry is required for the next full login.
    next.passwordVerifiedAt = null;
    return { ok: true, state: next };
  }

  next.otpAttempts += 1;
  if (next.otpAttempts >= OTP_MAX_ATTEMPTS && !next.otpLockedUntil) {
    next.otpLockedUntil = now + OTP_LOCKOUT_MS;
  }
  return { ok: false, state: next, expired };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

const AUDIT_RECORD_TYPE = "admin_audit_log";

export async function logAdminAction(db, { adminWallet, action, escrowId, details }, localAppend) {
  const entry = {
    id: crypto.randomUUID(),
    adminWallet: (adminWallet || "").toLowerCase(),
    action,
    escrowId: escrowId || null,
    details: details || null,
    at: Date.now(),
  };
  if (db) {
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())`,
      [AUDIT_RECORD_TYPE, entry.id, JSON.stringify(entry)]
    );
    return entry;
  }
  if (localAppend) localAppend(entry);
  return entry;
}

export async function getAuditLog(db, { limit = 100, escrowId } = {}, localList) {
  let entries;
  if (db) {
    const result = await db.query(
      "SELECT data FROM proofpay_records WHERE record_type = $1 ORDER BY updated_at DESC LIMIT 500",
      [AUDIT_RECORD_TYPE]
    );
    entries = result.rows.map((row) => row.data);
  } else {
    entries = localList || [];
  }
  if (escrowId) entries = entries.filter((e) => e.escrowId === escrowId);
  return entries.sort((a, b) => b.at - a.at).slice(0, limit);
}
