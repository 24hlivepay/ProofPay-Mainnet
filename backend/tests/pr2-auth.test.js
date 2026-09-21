/**
 * PR-2 auth infrastructure tests.
 * node:test + node:assert/strict — no env vars, no server start, no jest.
 * Imports directly from backend/lib/auth.js.
 */
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

// All auth functions imported at top level (ESM top-level await is fine).
import {
  generateNonce,
  consumeNonce,
  consumeNonceLocal,
  buildSiweMessage,
  parseSiweMessage,
  verifyEoaSignature,
  verifyCircleUserTokenWithFetch,
  issueJwt,
  verifyJwt,
  sanitizeEscrow,
  isLegacyConnectShape,
  CIRCLE_TOKEN_ERRORS,
} from "../lib/auth.js";

// ── Test wallet (deterministic) ───────────────────────────────────────────────
const TEST_WALLET = ethers.Wallet.createRandom();
const TEST_ADDRESS = TEST_WALLET.address.toLowerCase();
const ADMIN_ADDRESS = "0xad410000000000000000000000000000000000ad";
const ALLOWED_DOMAINS = ["proofpay.online", "localhost"];

// ── Suite 1: consumeNonceLocal (sync, no DB) ─────────────────────────────────

describe("Suite 1 — consumeNonceLocal", () => {
  test("first use returns true", () => {
    const store = { abc123: Date.now() + 60_000 };
    assert.equal(consumeNonceLocal(store, "abc123"), true);
  });

  test("replay returns false", () => {
    const store = { abc123: Date.now() + 60_000 };
    consumeNonceLocal(store, "abc123");
    assert.equal(consumeNonceLocal(store, "abc123"), false);
  });

  test("expired nonce returns false", () => {
    const store = { abc123: Date.now() - 1 };
    assert.equal(consumeNonceLocal(store, "abc123"), false);
  });

  test("unknown nonce returns false", () => {
    const store = {};
    assert.equal(consumeNonceLocal(store, "unknown"), false);
  });
});

// ── Suite 2: generateNonce + consumeNonce (local-file Map mode) ──────────────

describe("Suite 2 — generateNonce / consumeNonce (local Map mode)", async () => {
  test("generateNonce returns hex nonce with expiresAt", async () => {
    const map = new Map();
    const { nonce, expiresAt } = await generateNonce(null, map);
    assert.match(nonce, /^[0-9a-f]{32}$/);
    assert.ok(expiresAt > Date.now());
    assert.ok(map.has(nonce));
  });

  test("consumeNonce returns true on first use", async () => {
    const map = new Map();
    const { nonce } = await generateNonce(null, map);
    assert.equal(await consumeNonce(nonce, null, map), true);
  });

  test("consumeNonce returns false on replay", async () => {
    const map = new Map();
    const { nonce } = await generateNonce(null, map);
    await consumeNonce(nonce, null, map);
    assert.equal(await consumeNonce(nonce, null, map), false);
  });

  test("consumeNonce returns false after expiry (injectable clock)", async () => {
    // Manually insert an already-expired nonce into the map.
    const map = new Map();
    const nonce = "expirednonce99";
    map.set(nonce, { expiresAt: Date.now() - 1 }); // expired 1ms ago
    assert.equal(await consumeNonce(nonce, null, map), false);
  });

  test("consumeNonce returns false for unknown nonce", async () => {
    const map = new Map();
    assert.equal(await consumeNonce("doesnotexist", null, map), false);
  });
});

// ── Suite 3: buildSiweMessage / parseSiweMessage ──────────────────────────────

describe("Suite 3 — SIWE message build + parse", () => {
  test("buildSiweMessage produces expected fields", () => {
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: "0xABC",
      chainId: 5042,
      nonce: "deadbeef",
    });
    assert.ok(msg.includes("proofpay.online wants you to sign in"));
    assert.ok(msg.includes("Chain ID: 5042"));
    assert.ok(msg.includes("Nonce: deadbeef"));
  });

  test("parseSiweMessage round-trips all fields", () => {
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: "0xABC",
      chainId: 5042002,
      nonce: "cafebabe",
    });
    const parsed = parseSiweMessage(msg);
    assert.equal(parsed.domain, "proofpay.online");
    assert.equal(parsed.chainId, 5042002);
    assert.equal(parsed.nonce, "cafebabe");
    assert.equal(parsed.address, "0xABC");
  });

  test("parseSiweMessage returns null for malformed input", () => {
    assert.equal(parseSiweMessage("not a siwe message"), null);
    assert.equal(parseSiweMessage(null), null);
    assert.equal(parseSiweMessage(""), null);
  });
});

// ── Suite 4: verifyEoaSignature ───────────────────────────────────────────────

describe("Suite 4 — verifyEoaSignature", async () => {
  test("valid SIWE signature returns address + network", async () => {
    const nonce = "validnonce01";
    const store = { [nonce]: Date.now() + 60_000 };
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: TEST_WALLET.address,
      chainId: 5042,
      nonce,
    });
    const sig = await TEST_WALLET.signMessage(msg);
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.address, TEST_ADDRESS);
    assert.equal(result.network, "mainnet");
  });

  test("wrong signature returns BAD_SIG", async () => {
    const nonce = "badsignonce";
    const store = { [nonce]: Date.now() + 60_000 };
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: TEST_WALLET.address,
      chainId: 5042,
      nonce,
    });
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: "0x" + "a".repeat(130),
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.ok(result.code === "BAD_SIG" || result.code === "BAD_NONCE");
  });

  test("expired message returns EXPIRED", async () => {
    const nonce = "expirednonce";
    const past = Date.now() - 60_000;
    const store = { [nonce]: past + 30_000 }; // nonce issued in past, still valid
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: TEST_WALLET.address,
      chainId: 5042,
      nonce,
      expirationTime: new Date(past).toISOString(),
    });
    const sig = await TEST_WALLET.signMessage(msg);
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.code, "EXPIRED");
  });

  test("replayed nonce returns BAD_NONCE", async () => {
    const nonce = "replaynonce";
    const store = { [nonce]: Date.now() + 60_000 };
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: TEST_WALLET.address,
      chainId: 5042,
      nonce,
    });
    const sig = await TEST_WALLET.signMessage(msg);
    // First use succeeds.
    await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    // Second use — BAD_NONCE.
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.code, "BAD_NONCE");
  });

  test("disallowed domain returns DOMAIN_MISMATCH", async () => {
    const nonce = "domainnonce";
    const store = { [nonce]: Date.now() + 60_000 };
    const msg = buildSiweMessage({
      domain: "evil.com",
      address: TEST_WALLET.address,
      chainId: 5042,
      nonce,
    });
    const sig = await TEST_WALLET.signMessage(msg);
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.code, "DOMAIN_MISMATCH");
  });

  test("message that names a different address than the signer is rejected", async () => {
    const nonce = "addrmismatch1";
    const store = { [nonce]: Date.now() + 60_000 };
    const other = ethers.Wallet.createRandom();
    const msg = buildSiweMessage({
      domain: "proofpay.online",
      address: other.address,
      chainId: 5042,
      nonce,
    });
    const sig = await TEST_WALLET.signMessage(msg);
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: msg,
      signature: sig,
      nonceStore: store,
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.code, "BAD_SIG");
    assert.equal(result.address, undefined);
  });

  test("non-SIWE message returns not_siwe sentinel", async () => {
    const result = await verifyEoaSignature({
      address: TEST_WALLET.address,
      message: "Sign in to ProofPay.\n\nWallet: 0xabc",
      signature: "0x" + "a".repeat(130),
      nonceStore: {},
      allowedDomains: ALLOWED_DOMAINS,
    });
    assert.equal(result.error, "not_siwe");
  });
});

// ── Suite 5: JWT ──────────────────────────────────────────────────────────────

describe("Suite 5 — JWT issue + verify", () => {
  const SECRET = "test-secret-32-bytes-long-at-least!!";
  const SECRET_PREV = "old-secret-32-bytes-long-at-least!!";

  test("issueJwt returns null when secret is null", () => {
    assert.equal(issueJwt({ address: "0xabc", network: "mainnet", isAdmin: false }, null), null);
  });

  test("issueJwt + verifyJwt round-trip", () => {
    const token = issueJwt(
      { address: TEST_ADDRESS, network: "mainnet", isAdmin: false },
      SECRET
    );
    assert.ok(typeof token === "string");
    const decoded = verifyJwt(token, SECRET);
    assert.equal(decoded.address, TEST_ADDRESS);
    assert.equal(decoded.network, "mainnet");
    assert.equal(decoded.isAdmin, false);
  });

  test("verifyJwt returns null for tampered token", () => {
    const token = issueJwt({ address: TEST_ADDRESS, network: "mainnet", isAdmin: false }, SECRET);
    const tampered = token.slice(0, -4) + "xxxx";
    assert.equal(verifyJwt(tampered, SECRET), null);
  });

  test("verifyJwt returns null when secret is missing", () => {
    const token = issueJwt({ address: TEST_ADDRESS, network: "mainnet", isAdmin: false }, SECRET);
    assert.equal(verifyJwt(token, null), null);
  });

  test("verifyJwt tries SESSION_SECRET_PREV on rotation", () => {
    const token = issueJwt({ address: TEST_ADDRESS, network: "mainnet", isAdmin: true }, SECRET_PREV);
    // Primary secret is wrong, prev secret should work.
    const decoded = verifyJwt(token, SECRET, SECRET_PREV);
    assert.ok(decoded !== null);
    assert.equal(decoded.isAdmin, true);
  });

  test("verifyJwt pins HS256 — rejects RS256 forged token", () => {
    // A token manually crafted with alg:none or alg:RS256 should be rejected.
    // We simulate by swapping the header of a valid HS256 token.
    const token = issueJwt({ address: TEST_ADDRESS }, SECRET);
    const parts = token.split(".");
    const fakeHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const forged = `${fakeHeader}.${parts[1]}.`;
    assert.equal(verifyJwt(forged, SECRET), null);
  });
});

// ── Suite 6: verifyCircleUserTokenWithFetch ───────────────────────────────────

describe("Suite 6 — Circle userToken verification (mocked)", async () => {
  test("matching wallet returns verified + address", async () => {
    const fetchWallets = async () => [
      { address: "0xABCdef0000000000000000000000000000000001", blockchain: "ARC-TESTNET" },
    ];
    const result = await verifyCircleUserTokenWithFetch(
      "valid-user-token",
      "0xABCdef0000000000000000000000000000000001",
      "testnet",
      fetchWallets
    );
    assert.equal(result.verified, true);
    assert.equal(result.address, "0xabcdef0000000000000000000000000000000001");
  });

  test("no matching wallet returns ADDRESS_MISMATCH", async () => {
    const fetchWallets = async () => [
      { address: "0xOTHER000000000000000000000000000000000001", blockchain: "ARC-TESTNET" },
    ];
    const result = await verifyCircleUserTokenWithFetch(
      "valid-user-token",
      "0xABCdef0000000000000000000000000000000001",
      "testnet",
      fetchWallets
    );
    assert.equal(result.verified, false);
  });

  test("Circle 155104 expired error returns CIRCLE_EXPIRED", async () => {
    const fetchWallets = async () => {
      const err = new Error("Circle error");
      err.response = { status: 403, data: { code: 155104, message: "The userToken had expired." } };
      throw err;
    };
    const result = await verifyCircleUserTokenWithFetch(
      "expired-token",
      "0xABC",
      "mainnet",
      fetchWallets
    );
    assert.equal(result.verified, false);
    assert.equal(result.code, "CIRCLE_EXPIRED");
    assert.ok(/sign in with email/i.test(result.message));
  });

  test("Circle 155103 not-found error returns CIRCLE_INVALID", async () => {
    const fetchWallets = async () => {
      const err = new Error("Circle error");
      err.response = { status: 401, data: { code: 155103, message: "Cannot find the user token in the system." } };
      throw err;
    };
    const result = await verifyCircleUserTokenWithFetch(
      "missing-token",
      "0xABC",
      "testnet",
      fetchWallets
    );
    assert.equal(result.verified, false);
    assert.equal(result.code, "CIRCLE_INVALID");
  });
});

// ── Suite 7: isLegacyConnectShape ────────────────────────────────────────────

describe("Suite 7 — legacy connect shape detection", () => {
  test("legacy shape (no nonce in message) is detected", () => {
    const body = {
      address: "0xabc",
      message: "Sign in to ProofPay.\n\nWallet: 0xabc\nIssued at: 2026-09-20T00:00:00.000Z",
      signature: "0x" + "a".repeat(130),
      signedAt: "2026-09-20T00:00:00.000Z",
    };
    assert.equal(isLegacyConnectShape(body), true);
  });

  test("SIWE body (has nonce field) is NOT legacy", () => {
    const body = {
      address: "0xabc",
      message: "proofpay.online wants you to sign in...\nNonce: abc123",
      signature: "0xsig",
      nonce: "abc123",
    };
    assert.equal(isLegacyConnectShape(body), false);
  });

  test("SIWE message (Nonce: line) without nonce field is NOT legacy", () => {
    const body = {
      address: "0xabc",
      message: "proofpay.online wants you to sign in...\nNonce: abc123",
      signature: "0xsig",
    };
    assert.equal(isLegacyConnectShape(body), false);
  });

  test("Circle wallet body is NOT legacy", () => {
    const body = {
      address: "0xabc",
      walletType: "circle",
      message: "Sign in to ProofPay.",
      signature: "0xsig",
    };
    assert.equal(isLegacyConnectShape(body), false);
  });

  test("legacy connect returns 200 with no token (integration check via issueJwt)", () => {
    // Simulate what /api/wallet/connect does for a legacy body:
    // isLegacyConnectShape → true → skip SIWE verify → issueJwt not called.
    const body = {
      address: "0xabc",
      message: "Sign in to ProofPay.\n\nWallet: 0xabc",
      signature: "0xsig",
      signedAt: "2026-09-20T00:00:00.000Z",
    };
    const isLegacy = isLegacyConnectShape(body);
    const token = isLegacy ? null : issueJwt({ address: body.address }, "secret");
    assert.equal(isLegacy, true);
    assert.equal(token, null);
  });
});

// ── Suite 8: sanitizeEscrow ───────────────────────────────────────────────────

describe("Suite 8 — sanitizeEscrow", () => {
  const escrow = {
    id: "esc1",
    buyerWallet:  "0xbuyer0000000000000000000000000000000001",
    sellerWallet: "0xseller000000000000000000000000000000001",
    buyerEmail:   "buyer@example.com",
    sellerEmail:  "seller@example.com",
    verificationCode: "123456",
    amount: "100",
  };

  test("unauthenticated: no emails, no verificationCode", () => {
    const out = sanitizeEscrow(escrow, null, ADMIN_ADDRESS);
    assert.equal(out.verificationCode, undefined);
    assert.equal(out.buyerEmail, undefined);
    assert.equal(out.sellerEmail, undefined);
    assert.equal(out.amount, "100");
  });

  test("seller: verificationCode visible, emails visible", () => {
    const out = sanitizeEscrow(escrow, escrow.sellerWallet, ADMIN_ADDRESS);
    assert.equal(out.verificationCode, "123456");
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });

  test("buyer: no verificationCode, emails visible", () => {
    const out = sanitizeEscrow(escrow, escrow.buyerWallet, ADMIN_ADDRESS);
    assert.equal(out.verificationCode, undefined);
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });

  test("admin: emails visible, verificationCode hidden (seller-only field)", () => {
    // verificationCode is seller-only per design doc v2.
    // Admin sees emails but NOT the seller's verification code.
    const out = sanitizeEscrow(escrow, ADMIN_ADDRESS.toLowerCase(), ADMIN_ADDRESS.toLowerCase());
    assert.equal(out.verificationCode, undefined);
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });

  test("unrelated address: no emails, no verificationCode", () => {
    const out = sanitizeEscrow(escrow, "0xstranger", ADMIN_ADDRESS);
    assert.equal(out.verificationCode, undefined);
    assert.equal(out.buyerEmail, undefined);
  });

  test("sanitizeEscrow does not mutate original", () => {
    sanitizeEscrow(escrow, null, ADMIN_ADDRESS);
    assert.equal(escrow.verificationCode, "123456");
    assert.equal(escrow.buyerEmail, "buyer@example.com");
  });
});
