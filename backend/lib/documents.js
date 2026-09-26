// Deal documents: agreements, screenshots and other proof that the buyer or the
// seller attaches to a deal while it is open. Pure helpers with no I/O, so the
// access rules can be unit-tested.
//
// Who can see a document: the buyer and the seller of the deal, and nobody else.
// Before the seller has accepted, the seller is the wallet the buyer pinned as
// `expectedSeller`.
//
// The ProofPay admin has NO access, before or after a dispute. These files can
// hold private material. If a dispute is opened, each side can attach whatever
// it wants the admin to see again, as evidence or in the dispute message box.

export const MAX_DEAL_DOCUMENTS_PER_SIDE = 5;

// Documents can be added while the deal is open. Once a dispute is opened, proof
// goes on the dispute itself (its own evidence and messages), not here.
export const DOCUMENT_UPLOAD_STATUSES = new Set([
  "Waiting Seller",
  "Seller Accepted",
  "Funds Locked",
  "Delivered",
]);

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

// "buyer", "seller", or null. The pinned seller counts as the seller before they accept.
export function dealPartySide(escrow, wallet) {
  if (!escrow || !wallet) return null;
  if (same(escrow.buyerWallet, wallet)) return "buyer";
  if (same(escrow.sellerWallet, wallet)) return "seller";
  if (!escrow.sellerWallet && same(escrow.expectedSeller, wallet)) return "seller";
  return null;
}

// Only the deal's own buyer and seller may see or open the documents.
export function canViewDocuments(escrow, wallet) {
  return dealPartySide(escrow, wallet) !== null;
}

export function canUploadDocuments(escrow) {
  return DOCUMENT_UPLOAD_STATUSES.has(escrow?.status);
}

export function documentSlotsLeft(escrow, side) {
  const used = (Array.isArray(escrow?.documents) ? escrow.documents : []).filter((doc) => doc.side === side).length;
  return Math.max(0, MAX_DEAL_DOCUMENTS_PER_SIDE - used);
}

// What the API may show about a document. Never the storage path, the storage
// URL or the hash.
export function publicDocuments(escrow) {
  return (Array.isArray(escrow?.documents) ? escrow.documents : []).map((doc) => ({
    id: doc.id,
    side: doc.side,
    name: doc.name,
    type: doc.type,
    size: doc.size,
    uploadedAt: doc.uploadedAt,
  }));
}
