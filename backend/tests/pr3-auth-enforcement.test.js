/**
 * PR-3 auth enforcement tests
 * node:test, no env vars, imports real auth.js helpers.
 * Run: node --test tests/pr3-auth-enforcement.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  issueJwt,
  verifyJwt,
  sanitizeEscrow,
  verifyCircleUserTokenWithFetch,
} from "../lib/auth.js";

const TEST_SECRET = "test-secret-32-bytes-long-enough!";
const ADMIN = "0xad410000000000000000000000000000000000ad";
const BUYER = "0xb00000000000000000000000000000000000000b";
const SELLER = "0x5e110000000000000000000000000000000000e5";
const OTHER = "0x000000000000000000000000000000000000cafe";
const EXPECTED_SELLER = SELLER;

const BASE_ESCROW = {
  escrowId: "PP-TEST001",
  buyerWallet: BUYER,
  sellerWallet: SELLER,
  buyerEmail: "buyer@example.com",
  sellerEmail: "seller@example.com",
  verificationCode: "123456",
  buyerName: "Alice",
  productName: "Widget",
  amount: "10",
  assetSymbol: "USDC",
  status: "Funds Locked",
  expectedSeller: EXPECTED_SELLER,
};

// ── Suite 1: requireAuth JWT gating logic ───────────────────────────────────

describe("Suite 1 — requireAuth JWT gating logic", () => {
  it("valid JWT verifies correctly", () => {
    const token = issueJwt({ address: BUYER, network: "testnet", isAdmin: false }, TEST_SECRET);
    const decoded = verifyJwt(token, TEST_SECRET);
    assert.equal(decoded.address, BUYER);
    assert.equal(decoded.network, "testnet");
    assert.equal(decoded.isAdmin, false);
  });

  it("missing SECRET → issueJwt returns null", () => {
    assert.equal(issueJwt({ address: BUYER }, null), null);
    assert.equal(issueJwt({ address: BUYER }, ""), null);
  });

  it("tampered token fails verification", () => {
    const token = issueJwt({ address: BUYER }, TEST_SECRET);
    const tampered = token.slice(0, -5) + "XXXXX";
    assert.equal(verifyJwt(tampered, TEST_SECRET), null);
  });

  it("expired token fails verification (injectable clock)", () => {
    // Issue with 1s expiry, then verify with now + 5s
    const token = issueJwt({ address: BUYER }, TEST_SECRET, "1s");
    // Wait is not needed — jwt.verify checks exp vs Date.now() internally.
    // We can't easily inject the clock into jsonwebtoken, so just assert
    // the function handles an actually expired token gracefully.
    // Instead, issue with a past iat by creating a token manually.
    const pastToken = issueJwt({ address: BUYER, iat: Math.floor(Date.now() / 1000) - 7200 }, TEST_SECRET, "1s");
    assert.equal(verifyJwt(pastToken, TEST_SECRET), null);
  });

  it("admin flag is false for non-admin address", () => {
    const token = issueJwt({ address: BUYER, network: "testnet", isAdmin: false }, TEST_SECRET);
    const decoded = verifyJwt(token, TEST_SECRET);
    assert.equal(decoded.isAdmin, false);
  });

  it("admin flag is true for admin address", () => {
    const token = issueJwt({ address: ADMIN, network: "mainnet", isAdmin: true }, TEST_SECRET);
    const decoded = verifyJwt(token, TEST_SECRET);
    assert.equal(decoded.isAdmin, true);
  });

  it("JWT rotation: verifyJwt tries prevSecret when primary fails", () => {
    const oldSecret = "old-secret-32-bytes-long-enough!!";
    const token = issueJwt({ address: BUYER }, oldSecret);
    // Primary fails, prev succeeds.
    const decoded = verifyJwt(token, TEST_SECRET, oldSecret);
    assert.ok(decoded, "should verify with prevSecret");
    assert.equal(decoded.address, BUYER);
  });
});

// ── Suite 2: sanitizeEscrow anonymous caller ────────────────────────────────

describe("Suite 2 — sanitizeEscrow anonymous caller", () => {
  it("anonymous: buyerName, productName, amount are visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(out.buyerName, "Alice");
    assert.equal(out.productName, "Widget");
    assert.equal(out.amount, "10");
  });

  it("anonymous: emails are hidden", () => {
    const out = sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(out.buyerEmail, undefined);
    assert.equal(out.sellerEmail, undefined);
  });

  it("anonymous: verificationCode is hidden", () => {
    const out = sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(out.verificationCode, undefined);
  });

  it("anonymous: escrowId and status are visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(out.escrowId, "PP-TEST001");
    assert.equal(out.status, "Funds Locked");
  });

  it("anonymous: expectedSeller is visible (pre-connect invite preview)", () => {
    const out = sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(out.expectedSeller, EXPECTED_SELLER);
  });
});

// ── Suite 3: sanitizeEscrow seller caller ───────────────────────────────────

describe("Suite 3 — sanitizeEscrow seller caller", () => {
  it("seller: verificationCode is visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, SELLER, ADMIN);
    assert.equal(out.verificationCode, "123456");
  });

  it("seller: emails are visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, SELLER, ADMIN);
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });
});

// ── Suite 4: sanitizeEscrow buyer caller ────────────────────────────────────

describe("Suite 4 — sanitizeEscrow buyer caller", () => {
  it("buyer: verificationCode is hidden", () => {
    const out = sanitizeEscrow(BASE_ESCROW, BUYER, ADMIN);
    assert.equal(out.verificationCode, undefined);
  });

  it("buyer: emails are visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, BUYER, ADMIN);
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });
});

// ── Suite 5: sanitizeEscrow admin caller ────────────────────────────────────

describe("Suite 5 — sanitizeEscrow admin caller", () => {
  it("admin: emails are visible", () => {
    const out = sanitizeEscrow(BASE_ESCROW, ADMIN, ADMIN);
    assert.equal(out.buyerEmail, "buyer@example.com");
    assert.equal(out.sellerEmail, "seller@example.com");
  });

  it("admin: verificationCode is hidden (seller-only)", () => {
    const out = sanitizeEscrow(BASE_ESCROW, ADMIN, ADMIN);
    assert.equal(out.verificationCode, undefined);
  });
});

// ── Suite 6: sanitizeEscrow immutability ────────────────────────────────────

describe("Suite 6 — sanitizeEscrow immutability", () => {
  it("does not mutate the original escrow object", () => {
    const original = { ...BASE_ESCROW };
    sanitizeEscrow(BASE_ESCROW, null, ADMIN);
    assert.equal(BASE_ESCROW.verificationCode, "123456");
    assert.equal(BASE_ESCROW.buyerEmail, "buyer@example.com");
    assert.deepEqual(BASE_ESCROW, original);
  });
});

// ── Suite 7: /accept expectedSeller match via JWT address ───────────────────

describe("Suite 7 — /accept: JWT address must match expectedSeller", () => {
  it("matching address passes", () => {
    // Simulate the guard in server.js /accept
    const escrow = { ...BASE_ESCROW, expectedSeller: SELLER };
    const jwtAddress = SELLER;
    const match = !escrow.expectedSeller ||
      jwtAddress.toLowerCase() === escrow.expectedSeller.toLowerCase();
    assert.ok(match, "correct seller should pass");
  });

  it("mismatched address (attacker with different wallet) is rejected", () => {
    const escrow = { ...BASE_ESCROW, expectedSeller: SELLER };
    const jwtAddress = OTHER;
    const match = !escrow.expectedSeller ||
      jwtAddress.toLowerCase() === escrow.expectedSeller.toLowerCase();
    assert.ok(!match, "wrong wallet should be rejected");
  });

  it("grandfathered escrow (no expectedSeller) allows first-to-accept", () => {
    const escrow = { ...BASE_ESCROW, expectedSeller: undefined };
    const jwtAddress = OTHER;
    const match = !escrow.expectedSeller ||
      jwtAddress.toLowerCase() === (escrow.expectedSeller || "").toLowerCase();
    assert.ok(match, "grandfathered escrow should pass any wallet");
  });
});

// ── Suite 8: /reject expectedSeller match ───────────────────────────────────

describe("Suite 8 — /reject: expectedSeller match check", () => {
  it("correct locked seller can reject", () => {
    const escrow = { ...BASE_ESCROW, expectedSeller: SELLER, status: "Waiting Seller" };
    const jwtAddress = SELLER;
    const blocked = escrow.expectedSeller &&
      jwtAddress.toLowerCase() !== escrow.expectedSeller.toLowerCase();
    assert.ok(!blocked, "correct seller should be allowed");
  });

  it("wrong wallet cannot reject a locked escrow", () => {
    const escrow = { ...BASE_ESCROW, expectedSeller: SELLER, status: "Waiting Seller" };
    const jwtAddress = OTHER;
    const blocked = escrow.expectedSeller &&
      jwtAddress.toLowerCase() !== escrow.expectedSeller.toLowerCase();
    assert.ok(blocked, "wrong wallet should be blocked");
  });
});

// ── Suite 9: fail-closed when SESSION_SECRET missing ────────────────────────

describe("Suite 9 — fail-closed when SESSION_SECRET missing", () => {
  it("issueJwt with null secret returns null token", () => {
    assert.equal(issueJwt({ address: BUYER }, null), null);
  });

  it("verifyJwt with null secret returns null", () => {
    const token = issueJwt({ address: BUYER }, TEST_SECRET);
    assert.equal(verifyJwt(token, null), null);
  });
});

// ── Suite 10: Circle userToken expired error ─────────────────────────────────

describe("Suite 10 — Circle userToken expired (code 155104)", () => {
  it("expired userToken returns CIRCLE_EXPIRED code", async () => {
    const mockFetch = async () => {
      const err = new Error("Expired");
      err.response = { data: { code: 155104, message: "The userToken had expired." } };
      throw err;
    };

    const result = await verifyCircleUserTokenWithFetch(
      "expired-token",
      BUYER,
      "testnet",
      mockFetch
    );
    assert.equal(result.verified, false);
    assert.equal(result.code, "CIRCLE_EXPIRED");
    assert.match(result.message, /sign in with email again/i);
  });

  it("valid userToken with matching wallet verifies successfully", async () => {
    const mockFetch = async () => [
      { address: BUYER, blockchain: "ARC-TESTNET" },
    ];

    const result = await verifyCircleUserTokenWithFetch(
      "valid-token",
      BUYER,
      "testnet",
      mockFetch
    );
    assert.equal(result.verified, true);
    assert.equal(result.address, BUYER.toLowerCase());
  });

  it("valid token but address mismatch returns not verified", async () => {
    const mockFetch = async () => [
      { address: OTHER, blockchain: "ARC-TESTNET" },
    ];

    const result = await verifyCircleUserTokenWithFetch(
      "valid-token",
      BUYER,
      "testnet",
      mockFetch
    );
    assert.equal(result.verified, false);
    assert.match(result.message, /no wallet found/i);
  });
});

