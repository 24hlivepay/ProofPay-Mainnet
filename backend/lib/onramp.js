/**
 * backend/lib/onramp.js
 *
 * A record of each Onramp (buy USDC / EURC) attempt: which wallet opened the
 * widget, and how far the purchase got. Self-contained (no Express) --
 * imported by server.js and by tests.
 *
 * Circle's widget handles the purchase itself and only tells the browser what
 * happened, so these rows are what the browser reported, not proof of a
 * payment (the chain, and later Circle's webhooks, are the proof). A customer
 * who closes the tab after paying leaves a row at "submitted" even though the
 * deposit settles. The wallet address always comes from the verified JWT.
 *
 * Stored in proofpay_records (record_type "onramp_purchase", record_id
 * "<wallet>:<network>:<clientId>"), or a local JSON array without DATABASE_URL.
 */

const RECORD_TYPE = "onramp_purchase";
export const MAX_ONRAMP_RETURNED = 200;

// A later report only replaces the status when it is further along, so a
// stray "opened" or "not_completed" can never undo a settled purchase.
const STATUS_RANK = { opened: 0, not_completed: 1, submitted: 2, settled: 3 };
const LABEL = /^[A-Za-z0-9 .()\-_/]{1,40}$/;
const AMOUNT = /^\d{1,18}(\.\d{1,18})?$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const ORDER_ID = /^[A-Za-z0-9._:-]{1,100}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const DETAILS = ["amount", "tokenSymbol", "paymentMethod", "orderId", "transactionHash", "code"];

function cleanMatch(value, pattern) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return pattern.test(text) ? text : null;
}

/**
 * Validate a reported widget event. Returns { entry } or { error }.
 * { clientId, status, amount?, tokenSymbol?, paymentMethod?, orderId?, transactionHash?, code? }
 */
export function sanitizeOnrampEvent(input) {
  const body = input && typeof input === "object" ? input : {};
  if (!Object.hasOwn(STATUS_RANK, body.status)) return { error: "Unknown onramp status." };
  const clientId = cleanMatch(body.clientId, CLIENT_ID);
  if (!clientId) return { error: "A valid clientId is required." };
  return {
    entry: {
      clientId,
      status: body.status,
      amount: cleanMatch(body.amount, AMOUNT),
      tokenSymbol: cleanMatch(body.tokenSymbol, LABEL),
      paymentMethod: cleanMatch(body.paymentMethod, LABEL),
      orderId: cleanMatch(body.orderId, ORDER_ID),
      transactionHash: cleanMatch(body.transactionHash, TX_HASH),
      code: cleanMatch(body.code, LABEL),
    },
  };
}

function normalize(address) {
  return String(address || "").toLowerCase();
}

function merge(existing, entry, wallet, network) {
  const now = Date.now();
  const next = existing
    ? { ...existing, updatedAt: now }
    : { clientId: entry.clientId, wallet, network, status: entry.status, createdAt: now, updatedAt: now };
  if (STATUS_RANK[entry.status] > STATUS_RANK[next.status]) next.status = entry.status;
  for (const field of DETAILS) next[field] = entry[field] ?? next[field] ?? null;
  return next;
}

/**
 * Stores or advances one attempt (one row per clientId, i.e. per opened
 * widget). Returns the local array to write back in file mode, or null in
 * database mode.
 */
export async function recordOnrampEvent(db, wallet, network, entry, localEntries) {
  const key = normalize(wallet);
  if (!key) throw new Error("A wallet address is required.");
  const id = `${key}:${network}:${entry.clientId}`;

  if (db) {
    const found = await db.query(
      "SELECT data FROM proofpay_records WHERE record_type = $1 AND record_id = $2",
      [RECORD_TYPE, id]
    );
    const record = merge(found.rows[0]?.data, entry, key, network);
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (record_type, record_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [RECORD_TYPE, id, JSON.stringify(record)]
    );
    return null;
  }

  const entries = Array.isArray(localEntries) ? localEntries : [];
  const existing = entries.find((item) => item.id === id);
  const record = { id, ...merge(existing, entry, key, network) };
  return existing ? entries.map((item) => (item.id === id ? record : item)) : [...entries, record];
}

/** Every wallet's attempts on one network, newest first -- for the admin page. */
export async function listOnramp(db, network, localEntries) {
  if (db) {
    const result = await db.query(
      `SELECT data FROM proofpay_records
       WHERE record_type = $1 AND data->>'network' = $2
       ORDER BY updated_at DESC LIMIT ${MAX_ONRAMP_RETURNED}`,
      [RECORD_TYPE, network]
    );
    return result.rows.map((row) => row.data);
  }

  return (Array.isArray(localEntries) ? localEntries : [])
    .filter((item) => item.network === network)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_ONRAMP_RETURNED)
    .map(({ id, ...rest }) => rest);
}
