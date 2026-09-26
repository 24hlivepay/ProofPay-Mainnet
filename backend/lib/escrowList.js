import { sanitizeEscrow } from "./auth.js";

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
    });
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
