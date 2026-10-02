/**
 * Onramp webhook purchase-record tests. node:test, no env vars.
 * Run: node --test tests/onrampWebhook.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldRecordOnrampEvent, recordOnrampPurchase } from "../lib/onrampWebhook.js";

describe("shouldRecordOnrampEvent", () => {
  it("only records a settled deposit", () => {
    assert.equal(shouldRecordOnrampEvent({ event: "DEPOSIT_SETTLED" }), true);
  });

  it("ignores other lifecycle events", () => {
    assert.equal(shouldRecordOnrampEvent({ event: "DEPOSIT_SUBMITTED" }), false);
    assert.equal(shouldRecordOnrampEvent({ event: "INITIALIZATION_SUCCESS" }), false);
    assert.equal(shouldRecordOnrampEvent({}), false);
    assert.equal(shouldRecordOnrampEvent(null), false);
  });
});

describe("recordOnrampPurchase", () => {
  const settled = {
    event: "DEPOSIT_SETTLED",
    payload: {
      orderId: "order-123",
      destinationAddress: "0xAbC0000000000000000000000000000000dEaD",
      tokenSymbol: "USDC",
      amount: "10.00",
      transactionHash: "0xhash",
    },
  };

  it("file mode: stores the record keyed by orderId, lowercases the wallet", async () => {
    const local = await recordOnrampPurchase(null, settled, {});
    assert.ok(local["order-123"]);
    assert.equal(local["order-123"].walletAddress, "0xabc0000000000000000000000000000000dead");
    assert.equal(local["order-123"].token, "USDC");
    assert.equal(local["order-123"].amount, "10.00");
    assert.equal(local["order-123"].transactionHash, "0xhash");
    assert.equal(local["order-123"].status, "settled");
  });

  it("file mode: a redelivery of the same orderId is a no-op, not a second record", async () => {
    let local = await recordOnrampPurchase(null, settled, {});
    const firstReceivedAt = local["order-123"].receivedAt;
    local = await recordOnrampPurchase(null, settled, local);
    assert.equal(Object.keys(local).length, 1);
    assert.equal(local["order-123"].receivedAt, firstReceivedAt);
  });

  it("file mode: a payload with no id still dedupes on exact-duplicate redelivery", async () => {
    const noId = { event: "DEPOSIT_SETTLED", payload: { tokenSymbol: "EURC", amount: "5" } };
    let local = await recordOnrampPurchase(null, noId, {});
    assert.equal(Object.keys(local).length, 1);
    local = await recordOnrampPurchase(null, noId, local);
    assert.equal(Object.keys(local).length, 1);
  });

  it("db mode: inserts with ON CONFLICT DO NOTHING and returns null (nothing to write to a file)", async () => {
    const rows = new Map();
    const db = {
      async query(sql, params) {
        assert.match(sql, /ON CONFLICT \(record_type, record_id\) DO NOTHING/);
        if (!rows.has(params[1])) rows.set(params[1], JSON.parse(params[2]));
        return { rows: [] };
      },
    };
    const result = await recordOnrampPurchase(db, settled, null);
    assert.equal(result, null);
    assert.ok(rows.has("order-123"));
    assert.equal(rows.get("order-123").token, "USDC");
  });
});
