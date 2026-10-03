/**
 * Onramp record tests. node:test, no env vars.
 * Run: node --test tests/onramp.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeOnrampEvent, recordOnrampEvent, listOnramp } from "../lib/onramp.js";

const HASH = `0x${"a".repeat(64)}`;
const opened = { clientId: "onramp-0001-aaaa", status: "opened" };
const submitted = { ...opened, status: "submitted", amount: 25, tokenSymbol: "USDC", paymentMethod: "card", orderId: "ord_123" };
const settled = { ...opened, status: "settled", transactionHash: HASH };

describe("sanitizeOnrampEvent", () => {
  it("keeps only known, well-formed fields", () => {
    const { entry } = sanitizeOnrampEvent({ ...submitted, injected: "<script>" });
    assert.equal(entry.amount, "25");
    assert.equal(entry.paymentMethod, "card");
    assert.equal(entry.injected, undefined);
    assert.equal(entry.transactionHash, null);
  });

  it("rejects an unknown status or clientId and drops odd values", () => {
    assert.ok(sanitizeOnrampEvent({ ...opened, status: "paid" }).error);
    assert.ok(sanitizeOnrampEvent({ ...opened, status: "constructor" }).error);
    assert.ok(sanitizeOnrampEvent({ ...opened, clientId: "x" }).error);
    assert.ok(sanitizeOnrampEvent(null).error);
    const { entry } = sanitizeOnrampEvent({ ...submitted, amount: "-5", tokenSymbol: "<b>", transactionHash: "0x12" });
    assert.equal(entry.amount, null);
    assert.equal(entry.tokenSymbol, null);
    assert.equal(entry.transactionHash, null);
  });
});

describe("recordOnrampEvent / listOnramp (file mode)", () => {
  const save = (local, body, wallet = "0xABC", network = "mainnet") =>
    recordOnrampEvent(null, wallet, network, sanitizeOnrampEvent(body).entry, local);

  it("keeps one row per widget and advances it, keeping earlier details", async () => {
    let local = await save([], opened);
    local = await save(local, submitted);
    local = await save(local, settled);
    assert.equal(local.length, 1);
    const [row] = await listOnramp(null, "mainnet", local);
    assert.equal(row.status, "settled");
    assert.equal(row.wallet, "0xabc");
    assert.equal(row.amount, "25");
    assert.equal(row.transactionHash, HASH);
    assert.equal(row.id, undefined);
  });

  it("never moves a settled purchase back", async () => {
    let local = await save([], settled);
    local = await save(local, { ...opened, status: "not_completed", code: "CANCELED_BY_CUSTOMER" });
    assert.equal(local[0].status, "settled");
  });

  it("lists every wallet on the asked network only", async () => {
    let local = await save([], opened);
    local = await save(local, { ...opened, clientId: "onramp-0002-bbbb" }, "0xdef");
    local = await save(local, opened, "0xabc", "testnet");
    assert.equal((await listOnramp(null, "mainnet", local)).length, 2);
    assert.equal((await listOnramp(null, "testnet", local)).length, 1);
  });
});
