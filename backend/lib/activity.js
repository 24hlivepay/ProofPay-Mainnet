/**
 * backend/lib/activity.js
 *
 * A wallet's Swap / Bridge history: what was swapped for what, or which token
 * went from which chain to which, so the user can look back at it from the
 * Swap / Bridge window. Self-contained (no Express) -- imported by server.js
 * and by tests.
 *
 * The browser reports a finished swap or bridge; the wallet address always
 * comes from the verified JWT, never the request, so one wallet cannot write
 * into or read another's history. These rows are a convenience for display,
 * not proof of anything (the chain is the proof) -- which is why every field
 * is validated down to plain symbols, numbers and https links.
 *
 * Stored in proofpay_records (record_type "swap_bridge_activity", record_id
 * "<wallet>:<network>:<clientId>"), or a local JSON array without DATABASE_URL.
 */

const RECORD_TYPE = "swap_bridge_activity";
export const MAX_ACTIVITY_RETURNED = 50;

const KINDS = new Set(["swap", "bridge"]);
const LABEL = /^[A-Za-z0-9 .()\-_/]{1,40}$/;
const AMOUNT = /^\d{1,18}(\.\d{1,18})?$/;
const CLIENT_ID = /^[A-Za-z0-9-]{8,64}$/;

function cleanLabel(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return LABEL.test(text) ? text : null;
}

function cleanAmount(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  return AMOUNT.test(text) ? text : null;
}

// What the user paid in fees, as the quote showed them: [{ label, amount, token }].
function cleanFees(value) {
  if (!Array.isArray(value)) return [];
  const fees = [];
  for (const item of value.slice(0, 6)) {
    const label = cleanLabel(item?.label);
    const amount = cleanAmount(item?.amount);
    const token = cleanLabel(item?.token);
    if (label && amount && token) fees.push({ label, amount, token });
  }
  return fees;
}

// How long the user was in the flow, in whole seconds.
function cleanDuration(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 && seconds <= 86400 ? seconds : null;
}

function cleanLinks(value) {
  if (!Array.isArray(value)) return [];
  const links = [];
  for (const item of value.slice(0, 5)) {
    const label = cleanLabel(item?.label);
    let href = null;
    try {
      const url = new URL(String(item?.href || ""));
      if (url.protocol === "https:" && url.href.length <= 300) href = url.href;
    } catch {
      // not a URL
    }
    if (label && href) links.push({ label, href });
  }
  return links;
}

/**
 * Validate a reported swap or bridge. Returns { entry } or { error }.
 * swap:   { kind, clientId, tokenIn, tokenOut, amountIn, amountOut?, fees?, durationSec?, links? }
 * bridge: { kind, clientId, token, sourceChain, destinationChain, sent, received?, fees?, durationSec?, links? }
 */
export function sanitizeActivity(input) {
  const body = input && typeof input === "object" ? input : {};
  if (!KINDS.has(body.kind)) return { error: "Unknown activity type." };
  const clientId = typeof body.clientId === "string" && CLIENT_ID.test(body.clientId) ? body.clientId : null;
  if (!clientId) return { error: "A valid clientId is required." };

  if (body.kind === "swap") {
    const tokenIn = cleanLabel(body.tokenIn);
    const tokenOut = cleanLabel(body.tokenOut);
    const amountIn = cleanAmount(body.amountIn);
    if (!tokenIn || !tokenOut || !amountIn) return { error: "A swap needs two tokens and the amount paid." };
    return {
      entry: {
        kind: "swap",
        clientId,
        tokenIn,
        tokenOut,
        amountIn,
        amountOut: cleanAmount(body.amountOut),
        fees: cleanFees(body.fees),
        durationSec: cleanDuration(body.durationSec),
        links: cleanLinks(body.links),
      },
    };
  }

  const token = cleanLabel(body.token);
  const sourceChain = cleanLabel(body.sourceChain);
  const destinationChain = cleanLabel(body.destinationChain);
  const sent = cleanAmount(body.sent);
  if (!token || !sourceChain || !destinationChain || !sent) {
    return { error: "A bridge needs a token, both chains and the amount sent." };
  }
  return {
    entry: {
      kind: "bridge",
      clientId,
      token,
      sourceChain,
      destinationChain,
      sent,
      received: cleanAmount(body.received),
      fees: cleanFees(body.fees),
      durationSec: cleanDuration(body.durationSec),
      links: cleanLinks(body.links),
    },
  };
}

function normalize(address) {
  return String(address || "").toLowerCase();
}

/**
 * Stores one entry (a repeat of the same clientId is ignored, so a retried
 * request cannot double-list a swap). Returns the local array to write back
 * in file mode, or null in database mode.
 */
export async function recordActivity(db, wallet, network, entry, localEntries) {
  const key = normalize(wallet);
  if (!key) throw new Error("A wallet address is required.");
  const id = `${key}:${network}:${entry.clientId}`;
  const record = { ...entry, wallet: key, network, createdAt: Date.now() };

  if (db) {
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (record_type, record_id) DO NOTHING`,
      [RECORD_TYPE, id, JSON.stringify(record)]
    );
    return null;
  }

  const entries = Array.isArray(localEntries) ? localEntries : [];
  if (entries.some((existing) => existing.id === id)) return entries;
  return [...entries, { id, ...record }];
}

/** The wallet's newest-first history on one network. */
export async function listActivity(db, wallet, network, localEntries) {
  const key = normalize(wallet);
  if (!key) return [];

  if (db) {
    const result = await db.query(
      `SELECT data FROM proofpay_records
       WHERE record_type = $1 AND record_id LIKE $2
       ORDER BY updated_at DESC LIMIT ${MAX_ACTIVITY_RETURNED}`,
      [RECORD_TYPE, `${key}:${network}:%`]
    );
    return result.rows.map((row) => row.data);
  }

  return (Array.isArray(localEntries) ? localEntries : [])
    .filter((item) => item.wallet === key && item.network === network)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ACTIVITY_RETURNED)
    .map(({ id, ...rest }) => rest);
}
