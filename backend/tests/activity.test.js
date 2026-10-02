/**
 * Swap / Bridge history tests. node:test, no env vars.
 * Run: node --test tests/activity.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeActivity, recordActivity, listActivity, MAX_ACTIVITY_RETURNED } from "../lib/activity.js";

const swap = { kind: "swap", clientId: "swap-0001-aaaa", tokenIn: "USDC", tokenOut: "EURC", amountIn: "10", amountOut: "8.9" };
const bridge = {
  kind: "bridge", clientId: "bridge-0001-bbb", token: "USDC", sourceChain: "Arc Mainnet",
  destinationChain: "Arbitrum", sent: "5", received: "4.919318",
  links: [{ label: "Sent from Arc Mainnet", href: "https://explorer.arc.io/tx/0xabc" }],
};

describe("sanitizeActivity", () => {
  it("accepts a swap and a bridge, keeping only known fields", () => {
    const s = sanitizeActivity({ ...swap, injected: "<script>" });
    assert.equal(s.entry.tokenIn, "USDC");
    assert.equal(s.entry.injected, undefined);
    assert.equal(s.entry.amountOut, "8.9");
    const b = sanitizeActivity(bridge);
    assert.equal(b.entry.sourceChain, "Arc Mainnet");
    assert.equal(b.entry.links.length, 1);
  });

  it("accepts a numeric amount and leaves an unknown received amount null", () => {
    const { entry } = sanitizeActivity({ ...swap, amountIn: 10, amountOut: undefined });
    assert.equal(entry.amountIn, "10");
    assert.equal(entry.amountOut, null);
  });

  it("rejects an unknown type, a missing clientId, bad amounts and odd labels", () => {
    assert.ok(sanitizeActivity({ ...swap, kind: "transfer" }).error);
    assert.ok(sanitizeActivity({ ...swap, clientId: "x" }).error);
    assert.ok(sanitizeActivity({ ...swap, amountIn: "1e-7" }).error);
    assert.ok(sanitizeActivity({ ...swap, amountIn: "-5" }).error);
    assert.ok(sanitizeActivity({ ...swap, tokenIn: "<b>USDC</b>" }).error);
    assert.ok(sanitizeActivity({ ...bridge, destinationChain: "" }).error);
    assert.ok(sanitizeActivity(null).error);
  });

  it("only keeps https links, so a reported link can never be javascript:", () => {
    const { entry } = sanitizeActivity({
      ...bridge,
      links: [
        { label: "ok", href: "https://explorer.arc.io/tx/0x1" },
        { label: "bad", href: "javascript:alert(1)" },
        { label: "http", href: "http://example.com" },
        { label: "<x>", href: "https://example.com" },
      ],
    });
    assert.deepEqual(entry.links, [{ label: "ok", href: "https://explorer.arc.io/tx/0x1" }]);
  });
});

describe("fees and duration", () => {
  it("keeps valid fee lines and a whole-second duration", () => {
    const { entry } = sanitizeActivity({
      ...swap,
      fees: [{ label: "Swap fee", amount: "0.002", token: "EURC" }, { label: "Network fee", amount: "0.00000068", token: "ETH" }],
      durationSec: 134,
    });
    assert.deepEqual(entry.fees, [
      { label: "Swap fee", amount: "0.002", token: "EURC" },
      { label: "Network fee", amount: "0.00000068", token: "ETH" },
    ]);
    assert.equal(entry.durationSec, 134);
  });

  it("drops malformed fee lines and out-of-range durations instead of failing the record", () => {
    const { entry } = sanitizeActivity({
      ...bridge,
      fees: [{ label: "<b>x</b>", amount: "1", token: "USDC" }, { label: "Fee", amount: "6.8e-7", token: "ETH" }, "junk", { label: "Ok", amount: "1", token: "USDC" }],
      durationSec: -5,
    });
    assert.deepEqual(entry.fees, [{ label: "Ok", amount: "1", token: "USDC" }]);
    assert.equal(entry.durationSec, null);
    assert.deepEqual(sanitizeActivity({ ...swap, fees: "nope" }).entry.fees, []);
    assert.equal(sanitizeActivity({ ...swap, durationSec: 1.5 }).entry.durationSec, null);
  });
});

describe("activity storage (file mode)", () => {
  it("records, lists newest first, and ignores a repeated clientId", async () => {
    let local = [];
    local = await recordActivity(null, "0xABC", "mainnet", sanitizeActivity(swap).entry, local);
    local = await recordActivity(null, "0xabc", "mainnet", sanitizeActivity(swap).entry, local);
    assert.equal(local.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 5));
    local = await recordActivity(null, "0xabc", "mainnet", sanitizeActivity(bridge).entry, local);
    const list = await listActivity(null, "0xAbC", "mainnet", local);
    assert.deepEqual(list.map((item) => item.kind), ["bridge", "swap"]);
    assert.equal(list[0].wallet, "0xabc");
  });

  it("keeps wallets and networks apart", async () => {
    let local = [];
    local = await recordActivity(null, "0xaaa", "mainnet", sanitizeActivity(swap).entry, local);
    local = await recordActivity(null, "0xaaa", "testnet", sanitizeActivity(bridge).entry, local);
    local = await recordActivity(null, "0xbbb", "mainnet", sanitizeActivity({ ...swap, clientId: "swap-0002-cccc" }).entry, local);
    assert.equal((await listActivity(null, "0xaaa", "mainnet", local)).length, 1);
    assert.equal((await listActivity(null, "0xaaa", "testnet", local)).length, 1);
    assert.equal((await listActivity(null, "0xbbb", "testnet", local)).length, 0);
  });

  it("caps the list", async () => {
    let local = [];
    for (let i = 0; i < MAX_ACTIVITY_RETURNED + 5; i += 1) {
      local = await recordActivity(null, "0xaaa", "mainnet", sanitizeActivity({ ...swap, clientId: `swap-${String(i).padStart(4, "0")}-zzzz` }).entry, local);
    }
    assert.equal((await listActivity(null, "0xaaa", "mainnet", local)).length, MAX_ACTIVITY_RETURNED);
  });

  it("requires a wallet", async () => {
    await assert.rejects(() => recordActivity(null, "", "mainnet", sanitizeActivity(swap).entry, []));
    assert.deepEqual(await listActivity(null, "", "mainnet", []), []);
  });
});

describe("activity storage (database mode)", () => {
  it("inserts once per id and reads by wallet+network prefix", async () => {
    const calls = [];
    const db = {
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [{ data: { kind: "swap" } }] };
      },
    };
    await recordActivity(db, "0xABC", "mainnet", sanitizeActivity(swap).entry, null);
    assert.match(calls[0].sql, /ON CONFLICT \(record_type, record_id\) DO NOTHING/);
    assert.equal(calls[0].params[1], "0xabc:mainnet:swap-0001-aaaa");
    const rows = await listActivity(db, "0xABC", "mainnet", null);
    assert.deepEqual(rows, [{ kind: "swap" }]);
    assert.equal(calls[1].params[1], "0xabc:mainnet:%");
    assert.match(calls[1].sql, /ORDER BY updated_at DESC/);
  });
});
