import api from "../services/api";
import { MAX_EVIDENCE_BYTES, readEvidenceFiles } from "./evidence";

// Deal documents: agreements, screenshots and other proof the buyer or the seller
// attaches to a deal while it is open. Only those two can see them (the ProofPay
// admin cannot). These limits mirror the backend (backend/lib/documents.js).
export const MAX_DEAL_DOCUMENTS_PER_SIDE = 5;
export const DOCUMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf";
export const OPEN_DEAL_STATUSES = ["Waiting Seller", "Seller Accepted", "Funds Locked", "Delivered"];

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A short reason a single chosen file cannot be uploaded, or "" if it is fine.
export function fileProblem(file) {
  if (!ALLOWED_TYPES.includes(file.type)) return "not a PDF, JPG, PNG or WEBP";
  if (file.size > MAX_EVIDENCE_BYTES) return "over 2 MB";
  return "";
}

// Adds newly chosen files to the ones already chosen. The browser's file box
// replaces its own selection every time, so the page keeps its own list. The same
// file (same name and size) is not added twice.
export function mergeSelectedFiles(current, chosen) {
  const known = new Set(current.map((file) => `${file.name}:${file.size}`));
  const added = [];
  for (const file of chosen) {
    const key = `${file.name}:${file.size}`;
    if (!known.has(key)) {
      known.add(key);
      added.push(file);
    }
  }
  return [...current, ...added];
}

// Returns a message for the first problem, or "" when the files can be uploaded.
export function checkDocumentFiles(files, slotsLeft = MAX_DEAL_DOCUMENTS_PER_SIDE) {
  if (!files || files.length === 0) return "Choose at least one file.";
  if (files.length > slotsLeft) {
    return slotsLeft === 0
      ? `You already added the maximum of ${MAX_DEAL_DOCUMENTS_PER_SIDE} documents.`
      : `You can add ${slotsLeft} more document${slotsLeft === 1 ? "" : "s"} (maximum ${MAX_DEAL_DOCUMENTS_PER_SIDE}).`;
  }
  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type)) return `${file.name}: only JPG, PNG, WEBP or PDF files are allowed.`;
    if (file.size > MAX_EVIDENCE_BYTES) return `${file.name} is larger than 2 MB.`;
  }
  return "";
}

// Uploads the files to a deal one request per file, so every request stays well
// under the server's request-size limit. A file that fails does not stop the
// rest. Returns the names that failed with the reason.
export async function uploadDealDocuments(escrowId, files) {
  const failed = [];
  for (const file of files) {
    try {
      const encoded = await readEvidenceFiles([file]);
      await api.post(`/escrow/${escrowId}/documents`, { files: encoded });
    } catch (error) {
      failed.push({
        name: file.name,
        message: error.response?.data?.message || error.message || "Upload failed.",
      });
    }
  }
  return { failed };
}

// Removes one of YOUR OWN documents from a deal that is still open. The stored copy is
// deleted; the other party keeps seeing a "removed" marker (name, who, when).
export async function removeDealDocument(escrowId, file) {
  try {
    await api.delete(`/escrow/${escrowId}/documents/${file.id}`);
  } catch (error) {
    throw new Error(error.response?.data?.message || "Unable to remove this file.");
  }
}

// Documents are private: the endpoint needs the session token, which a plain link
// cannot send, so fetch through the authenticated client and open the blob. The
// tab is opened inside the click so popup blockers allow it.
export async function openDealDocument(escrowId, file) {
  const tab = window.open("", "_blank");
  try {
    const response = await api.get(`/escrow/${escrowId}/documents/${file.id}`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    if (tab) {
      tab.location.href = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "document";
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    if (tab) tab.close();
    throw new Error(
      error.response?.status === 403
        ? "You do not have access to this file."
        : "Unable to open this file."
    );
  }
}
