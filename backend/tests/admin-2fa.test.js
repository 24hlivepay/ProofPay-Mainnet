/**
 * Admin 2FA (password + email OTP) tests.
 * node:test, no env vars, imports the real lib/adminAuth.js helpers.
 * Run: node --test tests/admin-2fa.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import {
  verifyAdminPassword,
  generateOtp,
  hashOtp,
  recordPasswordAttempt,
  isPasswordLocked,
  hasFreshPasswordVerification,
  PASSWORD_MAX_ATTEMPTS,
  PASSWORD_LOCKOUT_MS,
  PASSWORD_VALID_WINDOW_MS,
  issueOtpState,
  isOtpLocked,
  isOtpResendCoolingDown,
  recordOtpAttempt,
  OTP_MAX_ATTEMPTS,
  OTP_EXPIRY_MS,
  OTP_RESEND_COOLDOWN_MS,
} from "../lib/adminAuth.js";

const EMPTY_STATE = {
  passwordAttempts: 0,
  passwordLockedUntil: null,
  passwordVerifiedAt: null,
  otpHash: null,
  otpExpiresAt: null,
  otpAttempts: 0,
  otpLockedUntil: null,
  otpSentAt: null,
};

describe("Suite 1 — verifyAdminPassword", () => {
  it("correct password against its own hash verifies", async () => {
    const hash = bcrypt.hashSync("correct horse battery staple", 10);
    assert.equal(await verifyAdminPassword("correct horse battery staple", hash), true);
  });

  it("wrong password fails", async () => {
    const hash = bcrypt.hashSync("correct horse battery staple", 10);
    assert.equal(await verifyAdminPassword("wrong password", hash), false);
  });

  it("missing hash never throws, returns false (fail closed)", async () => {
    assert.equal(await verifyAdminPassword("anything", null), false);
    assert.equal(await verifyAdminPassword("anything", ""), false);
  });

  it("missing password returns false", async () => {
    const hash = bcrypt.hashSync("x", 10);
    assert.equal(await verifyAdminPassword("", hash), false);
    assert.equal(await verifyAdminPassword(null, hash), false);
  });
});

describe("Suite 2 — password attempt lockout", () => {
  it("success resets attempts and sets passwordVerifiedAt", () => {
    const now = 1_000_000;
    const state = recordPasswordAttempt({ ...EMPTY_STATE, passwordAttempts: 3 }, true, now);
    assert.equal(state.passwordAttempts, 0);
    assert.equal(state.passwordLockedUntil, null);
    assert.equal(state.passwordVerifiedAt, now);
  });

  it(`locks after ${PASSWORD_MAX_ATTEMPTS} consecutive failures`, () => {
    let state = { ...EMPTY_STATE };
    const now = 1_000_000;
    for (let i = 0; i < PASSWORD_MAX_ATTEMPTS; i++) {
      state = recordPasswordAttempt(state, false, now);
    }
    assert.equal(state.passwordAttempts, PASSWORD_MAX_ATTEMPTS);
    assert.equal(isPasswordLocked(state, now), true);
    assert.equal(state.passwordLockedUntil, now + PASSWORD_LOCKOUT_MS);
  });

  it("does not lock before reaching the threshold", () => {
    let state = { ...EMPTY_STATE };
    const now = 1_000_000;
    for (let i = 0; i < PASSWORD_MAX_ATTEMPTS - 1; i++) {
      state = recordPasswordAttempt(state, false, now);
    }
    assert.equal(isPasswordLocked(state, now), false);
  });

  it("lockout expires and resets attempts on the next try (no permanent lockout)", () => {
    let state = { ...EMPTY_STATE };
    const start = 1_000_000;
    for (let i = 0; i < PASSWORD_MAX_ATTEMPTS; i++) {
      state = recordPasswordAttempt(state, false, start);
    }
    assert.equal(isPasswordLocked(state, start), true);

    const afterExpiry = start + PASSWORD_LOCKOUT_MS + 1;
    assert.equal(isPasswordLocked(state, afterExpiry), false);

    // A wrong attempt right after expiry should reset to 1, not re-lock immediately.
    state = recordPasswordAttempt(state, false, afterExpiry);
    assert.equal(state.passwordAttempts, 1);
    assert.equal(isPasswordLocked(state, afterExpiry), false);
  });
});

describe("Suite 3 — password verification freshness window", () => {
  it("fresh right after success", () => {
    const now = 1_000_000;
    const state = recordPasswordAttempt(EMPTY_STATE, true, now);
    assert.equal(hasFreshPasswordVerification(state, now), true);
    assert.equal(hasFreshPasswordVerification(state, now + PASSWORD_VALID_WINDOW_MS - 1), true);
  });

  it("stale after the window expires", () => {
    const now = 1_000_000;
    const state = recordPasswordAttempt(EMPTY_STATE, true, now);
    assert.equal(hasFreshPasswordVerification(state, now + PASSWORD_VALID_WINDOW_MS + 1), false);
  });

  it("never verified is never fresh", () => {
    assert.equal(hasFreshPasswordVerification(EMPTY_STATE, Date.now()), false);
  });
});

describe("Suite 4 — OTP issue + verify", () => {
  it("correct OTP verifies and clears state", () => {
    const now = 1_000_000;
    const otp = "123456";
    const issued = issueOtpState({ ...EMPTY_STATE, passwordVerifiedAt: now }, otp, now);
    assert.equal(issued.otpHash, hashOtp(otp));

    const { ok, state } = recordOtpAttempt(issued, otp, now + 1000);
    assert.equal(ok, true);
    assert.equal(state.otpHash, null);
    assert.equal(state.otpExpiresAt, null);
    // Single-use: password proof is consumed so a fresh password is required next time.
    assert.equal(state.passwordVerifiedAt, null);
  });

  it("wrong OTP does not verify and increments attempts", () => {
    const now = 1_000_000;
    const issued = issueOtpState(EMPTY_STATE, "123456", now);
    const { ok, state } = recordOtpAttempt(issued, "000000", now + 1000);
    assert.equal(ok, false);
    assert.equal(state.otpAttempts, 1);
    // Correct OTP still stored, not consumed by a wrong guess.
    assert.equal(state.otpHash, hashOtp("123456"));
  });

  it("expired OTP is rejected even if correct", () => {
    const now = 1_000_000;
    const issued = issueOtpState(EMPTY_STATE, "123456", now);
    const { ok, expired } = recordOtpAttempt(issued, "123456", now + OTP_EXPIRY_MS + 1);
    assert.equal(ok, false);
    assert.equal(expired, true);
  });

  it(`locks after ${OTP_MAX_ATTEMPTS} wrong guesses`, () => {
    const now = 1_000_000;
    let state = issueOtpState(EMPTY_STATE, "123456", now);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      ({ state } = recordOtpAttempt(state, "000000", now));
    }
    assert.equal(isOtpLocked(state, now), true);
  });

  it("OTP lockout expires and resets on the next try", () => {
    const now = 1_000_000;
    let state = issueOtpState(EMPTY_STATE, "123456", now);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      ({ state } = recordOtpAttempt(state, "000000", now));
    }
    assert.equal(isOtpLocked(state, now), true);
    const afterExpiry = now + 10 * 60 * 1000 + 1;
    assert.equal(isOtpLocked(state, afterExpiry), false);
  });

  it("resend cooldown blocks immediate re-send", () => {
    const now = 1_000_000;
    const issued = issueOtpState(EMPTY_STATE, "123456", now);
    assert.equal(isOtpResendCoolingDown(issued, now + 1), true);
    assert.equal(isOtpResendCoolingDown(issued, now + OTP_RESEND_COOLDOWN_MS + 1), false);
  });
});

describe("Suite 5 — generateOtp / hashOtp", () => {
  it("generates a 6-digit numeric code", () => {
    for (let i = 0; i < 20; i++) {
      const otp = generateOtp();
      assert.match(otp, /^\d{6}$/);
    }
  });

  it("hash is deterministic and does not equal the raw OTP", () => {
    const otp = "654321";
    const h1 = hashOtp(otp);
    const h2 = hashOtp(otp);
    assert.equal(h1, h2);
    assert.notEqual(h1, otp);
  });

  it("different OTPs hash differently", () => {
    assert.notEqual(hashOtp("111111"), hashOtp("222222"));
  });
});

describe("Suite 6 — full-cycle simulation (password -> otp -> next login requires password again)", () => {
  it("cannot request OTP without a fresh password verification", () => {
    // Simulates the /send-otp route's own check.
    assert.equal(hasFreshPasswordVerification(EMPTY_STATE, Date.now()), false);
  });

  it("two consecutive logins each require their own password + OTP", () => {
    const t0 = 1_000_000;
    let state = recordPasswordAttempt(EMPTY_STATE, true, t0);
    assert.equal(hasFreshPasswordVerification(state, t0), true);

    state = issueOtpState(state, "111111", t0 + 10);
    const first = recordOtpAttempt(state, "111111", t0 + 20);
    assert.equal(first.ok, true);
    state = first.state;

    // Immediately trying to send another OTP without re-entering the password fails.
    assert.equal(hasFreshPasswordVerification(state, t0 + 30), false);

    // A second login cycle needs a fresh password verification again.
    state = recordPasswordAttempt(state, true, t0 + 1000);
    assert.equal(hasFreshPasswordVerification(state, t0 + 1000), true);
  });
});

describe("Suite 7 — dispute alert email", async () => {
  const { buildDisputeAlertEmail, sendAdminEmail } = await import("../lib/adminAuth.js");
  const escrow = {
    escrowId: "PP-ABC123",
    amount: "25",
    assetSymbol: "EURC",
    network: "mainnet",
    dispute: {
      openedBySide: "buyer",
      reason: "Item not\nas described",
      statement: "SECRET FULL STATEMENT <script>alert(1)</script>",
    },
  };

  it("includes escrow, amount, opener and reason, plus the admin link", () => {
    const { subject, text } = buildDisputeAlertEmail(escrow, "https://x.test/#/admin/disputes");
    assert.match(subject, /PP-ABC123/);
    assert.match(subject, /25 EURC/);
    assert.match(text, /Opened by: buyer/);
    assert.match(text, /Reason: Item not as described/);
    assert.match(text, /https:\/\/x\.test\/#\/admin\/disputes/);
  });

  it("never includes the user's full statement", () => {
    const { text } = buildDisputeAlertEmail(escrow, "https://x.test");
    assert.doesNotMatch(text, /SECRET FULL STATEMENT/);
    assert.doesNotMatch(text, /<script>/);
  });

  it("caps an oversized reason", () => {
    const big = { ...escrow, dispute: { ...escrow.dispute, reason: "r".repeat(5000) } };
    const { text } = buildDisputeAlertEmail(big, "https://x.test");
    assert.ok(text.length < 600);
  });

  it("posts to Resend with the API key and recipient", async () => {
    let seen;
    await sendAdminEmail(
      { subject: "s", text: "t" },
      { apiKey: "k", toEmail: "a@b.c", fetchImpl: async (url, init) => { seen = { url, init }; return { ok: true }; } }
    );
    assert.equal(seen.url, "https://api.resend.com/emails");
    assert.equal(seen.init.headers.Authorization, "Bearer k");
    assert.deepEqual(JSON.parse(seen.init.body).to, ["a@b.c"]);
  });

  it("throws on a non-2xx Resend response", async () => {
    await assert.rejects(
      sendAdminEmail({ subject: "s", text: "t" }, { apiKey: "k", toEmail: "a@b.c", fetchImpl: async () => ({ ok: false, status: 401, text: async () => "no" }) }),
      /Resend API error 401/
    );
  });
});
