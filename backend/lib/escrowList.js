import { sanitizeEscrow } from "./auth.js";

// When a deal last changed, so the newest activity (a released payment, a
// dispute settled by the admin, a cancellation) comes first in every list.
export function lastActivityAt(escrow) {
  const times = [
    escrow.dispute?.resolution?.resolvedAt,
    escrow.dispute?.openedAt,
    escrow.releasedAt,
    escrow.cancelledAt,
    escrow.deliveredAt,
    escrow.depositedAt,
    escrow.createdAt,
  ].map(Number).filter(Number.isFinite);
  return times.length ? Math.max(...times) : 0;
}

/*
 * The signed-in caller's own escrows for one dashboard list.
 *
 * The caller comes only from the verified sign-in token, never from a query
 * parameter, so nobody can ask for another wallet's deals. Each record goes
 * through sanitizeEscrow (no other party's verification code, emails only for
 * participants) and never carries deal documents.
 */
export function listEscrowsForCaller({
  allEscrows,
  network,
  escrowNetwork,
  category,
  statusCategories,
  role,
  callerAddress,
  adminAddress,
}) {
  const caller = (callerAddress || "").toLowerCase();
  if (!caller) return [];
  const allowedStatuses = statusCategories[category] || statusCategories.active;
  const recordRole = role === "seller" ? "seller" : "buyer";

  return allEscrows
    .filter((escrow) => {
      if (escrowNetwork(escrow) !== network) return false;
      const owner = recordRole === "seller" ? escrow.sellerWallet : escrow.buyerWallet;
      if ((owner || "").toLowerCase() !== caller) return false;
      if (category === "disputes") return Boolean(escrow.dispute);
      return allowedStatuses.includes(escrow.status);
    })
    .map((escrow) => {
      const { documents, ...rest } = sanitizeEscrow(escrow, callerAddress, adminAddress); // eslint-disable-line no-unused-vars
      return rest;
    })
    .sort((a, b) => lastActivityAt(b) - lastActivityAt(a));
}

const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");

/*
 * The only fields a client may set when it creates a deal. Everything else on
 * the record (status, dispute, resolution, verification code, documents, ...)
 * is set by the server.
 */
export function pickNewEscrowFields(body = {}) {
  return {
    buyerName: text(body.buyerName, 200),
    buyerWallet: text(body.buyerWallet, 64),
    buyerEmail: text(body.buyerEmail, 320),
    productName: text(body.productName, 300),
    productId: text(body.productId, 100),
    description: text(body.description, 5000),
    amount: typeof body.amount === "number" ? String(body.amount) : text(body.amount, 40),
  };
}
