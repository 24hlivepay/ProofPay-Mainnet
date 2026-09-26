// Large deal documents (up to 10 MB each) go from the browser straight to the private
// storage instead of through the API, because a serverless request body is limited to
// about 4.5 MB and a file sent as base64 is a third bigger. The API only (1) hands out a
// short-lived upload token for one exact path, and (2) after the upload, checks what
// really landed in storage and records it on the deal.
//
// Pure logic with the storage calls injected (`blob`), so the rules can be unit-tested
// without a storage account. Files of 2 MB or less keep using the original upload.
//
// Access rules are the same as for every deal document (see documents.js): only the
// deal's own buyer and seller, never the admin.

import crypto from "crypto";
import { canUploadDocuments, dealPartySide, documentSlotsLeft, MAX_DEAL_DOCUMENTS_PER_SIDE } from "./documents.js";

export const MAX_DEAL_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const DIRECT_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

// deals/<escrow id>/<buyer|seller>/<uuid>.<pdf|jpg|png|webp>
const PATHNAME_PATTERN = /^deals\/([A-Za-z0-9-]+)\/(buyer|seller)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|jpg|png|webp)$/;

export function parseDealDocumentPathname(pathname) {
  const match = PATHNAME_PATTERN.exec(String(pathname || ""));
  if (!match) return null;
  return { escrowId: match[1], side: match[2], id: match[3], extension: match[4] };
}

const fail = (status, message) => ({ ok: false, status, message });

// May this wallet get an upload token / register a file at this exact path?
export function authorizeDirectUpload({ escrow, wallet, pathname }) {
  if (!escrow) return fail(404, "Escrow Not Found");
  const side = dealPartySide(escrow, wallet);
  if (!side) return fail(403, "Only the buyer or the seller of this deal can add documents.");
  if (!canUploadDocuments(escrow)) {
    return fail(400, "Documents can only be added while the deal is open. Once a dispute is opened, attach proof in the dispute instead.");
  }
  const parsed = parseDealDocumentPathname(pathname);
  if (!parsed || parsed.escrowId !== escrow.escrowId || parsed.side !== side) {
    return fail(400, "Invalid upload path.");
  }
  if (documentSlotsLeft(escrow, side) < 1) {
    return fail(400, `You already added the maximum of ${MAX_DEAL_DOCUMENTS_PER_SIDE} documents.`);
  }
  return { ok: true, side };
}

// After the browser uploaded: look at what is really in storage (never trust what the
// browser says), and build the record to add to the deal. A file that does not fit the
// rules is deleted from storage again. `blob` = { head(url), sha256(url), del(url) }.
export async function registerDirectUpload({ escrow, wallet, pathname, url, name, blob, now = Date.now(), newId = () => crypto.randomUUID() }) {
  const allowed = authorizeDirectUpload({ escrow, wallet, pathname });
  if (!allowed.ok) return allowed;

  if ((escrow.documents || []).some((doc) => doc.blobPathname === pathname)) {
    return fail(400, "This file was already added.");
  }
  if (typeof url !== "string" || !url) return fail(400, "Missing file address.");

  let meta;
  try {
    meta = await blob.head(url);
  } catch {
    return fail(400, "We could not find the uploaded file. Please try again.");
  }

  const reject = async (message) => {
    try {
      await blob.del(url);
    } catch {
      // best effort: a leftover file that no deal record points to is not reachable by anyone
    }
    return fail(400, message);
  };

  if (!meta || meta.pathname !== pathname) return reject("The uploaded file does not match this deal.");
  if (!DIRECT_UPLOAD_TYPES.includes(meta.contentType)) return reject("Only JPG, PNG, WEBP or PDF files are allowed.");
  if (!(meta.size > 0)) return reject("The uploaded file is empty.");
  if (meta.size > MAX_DEAL_DOCUMENT_BYTES) return reject("Each document must be 10 MB or smaller.");

  let hash;
  try {
    hash = await blob.sha256(url);
  } catch {
    return reject("We could not read the uploaded file. Please try again.");
  }

  const document = {
    id: newId(),
    side: allowed.side,
    name: String(name || "document").slice(0, 120),
    type: meta.contentType,
    size: meta.size,
    path: "",
    blobUrl: url,
    blobPathname: pathname,
    hash,
    uploadedAt: now,
  };
  return { ok: true, document };
}
