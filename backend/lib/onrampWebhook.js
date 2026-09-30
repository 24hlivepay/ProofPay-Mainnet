/**
 * backend/lib/onrampWebhook.js
 *
 * Circle Onramp Kit deposit-completion records, so ProofPay has a durable
 * record of a purchase even if the user closes the tab before the widget's
 * own onDepositSettled callback fires. Circle's own docs say this twice:
 * "Webhooks remain the source of truth" for onramp deposit status -- see
 * docs.arc.io/app-kit/references/onramp-hosting-requirements and
 * docs.arc.io/app-kit/tutorials/onramp/handle-lifecycle-events.
 *
 * OPEN ITEM: Circle documents that Onramp webhooks exist and are
 * authoritative, but -- despite extensive searching of both
 * developers.circle.com and docs.arc.io -- no dedicated payload schema or
 * signature-verification scheme for the *server-side* Onramp webhook could
 * be found (only the *client-side* widget event shape is documented:
 * { event, code, payload } with event types like DEPOSIT_SETTLED). This
 * module assumes the server-side webhook body uses that same or a very
 * similar shape, and stores the raw body verbatim alongside the parsed
 * fields so nothing is lost if that assumption turns out wrong once a real
 * webhook call is observed. There is no signature check for the same
 * reason -- add one once Circle's actual scheme is confirmed (check the
 * Circle Console's Onramp Kit setup page for where the webhook URL is
 * registered, which may reveal it, or inspect a real delivery's headers).
 * This is acceptable short-term because the endpoint is purely informational
 * record-keeping -- it never moves funds or grants access, so a spoofed
 * call is a nuisance log entry, not a security breach.
 *
 * Stored in proofpay_records (record_type "onramp_purchase", record_id =
 * whatever unique id the payload provides, falling back to a hash of the
 * body so a delivery with no id still dedupes on exact-duplicate retries --
 * Circle's general webhook system documents at-least-once, possibly
 * duplicate delivery), or a local JSON file when there is no DATABASE_URL.
 */

import crypto from "crypto";

const RECORD_TYPE = "onramp_purchase";

function recordIdFor(body) {
  const candidate =
    body?.payload?.orderId || body?.orderId || body?.notificationId || body?.id;
  if (candidate) return String(candidate);
  return crypto.createHash("sha256").update(JSON.stringify(body || {})).digest("hex");
}

/**
 * Only a settled deposit is worth a durable record; other lifecycle events
 * (initialization, submitted-but-not-settled, cancellations) are transient
 * and already covered by the client-side callbacks for UI purposes.
 */
export function shouldRecordOnrampEvent(body) {
  return body?.event === "DEPOSIT_SETTLED";
}

/** Upserts (insert-if-absent) the purchase record; returns the local map to write back in file mode, or null in db mode. */
export async function recordOnrampPurchase(db, body, localPurchases) {
  const recordId = recordIdFor(body);
  const payload = body?.payload || {};
  const record = {
    recordId,
    event: body?.event || null,
    walletAddress: String(payload.destinationAddress || payload.address || "").toLowerCase() || null,
    token: payload.tokenSymbol || payload.symbol || null,
    amount: payload.amount ?? null,
    transactionHash: payload.transactionHash || null,
    status: "settled",
    receivedAt: Date.now(),
    raw: body,
  };

  if (db) {
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (record_type, record_id) DO NOTHING`,
      [RECORD_TYPE, recordId, JSON.stringify(record)]
    );
    return null;
  }

  if ((localPurchases || {})[recordId]) return localPurchases;
  return { ...(localPurchases || {}), [recordId]: record };
}
