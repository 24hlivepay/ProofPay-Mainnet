/**
 * Allowed-origin tests. node:test, no env vars.
 * Run: node --test tests/origins.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allowedOriginsFromEnv, isAllowedOrigin } from "../lib/origins.js";

const allowed = allowedOriginsFromEnv({
  VERCEL_URL: "proof-pay-abc123-proof-pay.vercel.app",
  VERCEL_BRANCH_URL: "proof-pay-git-some-branch-proof-pay.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "proofpay.online",
  FRONTEND_URL: "https://staging.example.org/",
});

describe("isAllowedOrigin", () => {
  it("allows production, local development and requests without an Origin", () => {
    for (const origin of ["https://proofpay.online", "https://www.proofpay.online", "http://localhost:5173", "https://proof-pay-mu.vercel.app", undefined, ""]) {
      assert.equal(isAllowedOrigin(origin, allowed), true, String(origin));
    }
  });

  it("allows this deployment's own hosts and the configured frontend", () => {
    assert.equal(isAllowedOrigin("https://proof-pay-abc123-proof-pay.vercel.app", allowed), true);
    assert.equal(isAllowedOrigin("https://proof-pay-git-some-branch-proof-pay.vercel.app", allowed), true);
    assert.equal(isAllowedOrigin("https://staging.example.org", allowed), true);
  });

  it("allows the project's preview shape even when Vercel's variables are missing", () => {
    const bare = allowedOriginsFromEnv({});
    assert.equal(isAllowedOrigin("https://proof-pay-git-review-fixes-oct6-proof-pay.vercel.app", bare), true);
    assert.equal(isAllowedOrigin("https://proof-pay-9xk2-proof-pay.vercel.app", bare), true);
  });

  it("no longer allows other sites on Vercel, or look-alikes", () => {
    const bare = allowedOriginsFromEnv({});
    for (const origin of [
      "https://evil.vercel.app",
      "https://proof-pay.vercel.app",
      "https://proof-pay-evil.vercel.app",
      "https://someone-proof-pay.vercel.app",
      "https://proof-pay-x-proof-pay.vercel.app.evil.com",
      "http://proof-pay-abc-proof-pay.vercel.app",
      "https://proofpay.online.evil.com",
      "https://evil.com",
      "null",
    ]) {
      assert.equal(isAllowedOrigin(origin, bare), false, origin);
    }
  });
});
