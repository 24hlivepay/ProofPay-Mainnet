import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";
import {
  DOCUMENT_ACCEPT,
  MAX_DEAL_DOCUMENTS_PER_SIDE,
  OPEN_DEAL_STATUSES,
  checkDocumentFiles,
  formatFileSize,
  openDealDocument,
  uploadDealDocuments,
} from "../utils/dealDocuments";

export const DOCUMENT_PRIVACY_NOTE =
  "Only you and the other party in this deal can open these files. The ProofPay admin cannot see them. If a dispute is opened, attach anything you want the admin to see again inside the dispute. Never upload passwords, seed phrases or private keys.";

// The deal's agreement / proof documents for the buyer or the seller viewing the
// page. It loads the deal itself, so a page only needs the escrow id. It renders
// nothing for anyone who is not the buyer or the seller of this deal (the server
// sends no documents to them), so it is safe to drop into any deal page.
export default function DealDocuments({ escrowId }) {
  const [escrow, setEscrow] = useState(null);
  const [files, setFiles] = useState([]);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/escrow/${escrowId}`);
      setEscrow(response.data.escrow || null);
    } catch {
      setEscrow(null);
    }
  }, [escrowId]);

  useEffect(() => {
    if (escrowId) load();
  }, [escrowId, load]);

  if (!escrow || !Array.isArray(escrow.documents)) return null;

  const wallet = String(getConnectedWallet() || "").toLowerCase();
  const mySide = wallet && wallet === String(escrow.buyerWallet || "").toLowerCase() ? "buyer" : "seller";
  const mine = escrow.documents.filter((doc) => doc.side === mySide);
  const theirs = escrow.documents.filter((doc) => doc.side !== mySide);
  const canUpload = OPEN_DEAL_STATUSES.includes(escrow.status);
  const slotsLeft = Math.max(0, MAX_DEAL_DOCUMENTS_PER_SIDE - mine.length);

  async function handleOpen(file) {
    try {
      setMessage(null);
      await openDealDocument(escrowId, file);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function handleUpload() {
    const problem = checkDocumentFiles(files, slotsLeft);
    if (problem) {
      setMessage({ type: "error", text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { failed } = await uploadDealDocuments(escrowId, files);
    await load();
    setFiles([]);
    setInputKey((key) => key + 1);
    setBusy(false);
    setMessage(
      failed.length > 0
        ? { type: "error", text: `Could not upload: ${failed.map((item) => `${item.name} (${item.message})`).join("; ")}` }
        : { type: "success", text: "Uploaded." }
    );
  }

  function renderDocumentList(title, documents) {
    return (
      <div className="mt-3">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {documents.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {documents.map((doc) => (
              <li key={doc.id}>
                <button type="button" onClick={() => handleOpen(doc)} className="text-left text-blue-700 underline">
                  {doc.name}
                </button>
                <span className="ml-2 text-xs text-slate-500">{formatFileSize(doc.size)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-bold text-slate-900">Agreement &amp; proof <span className="font-normal text-slate-500">(optional)</span></h3>
      <p className="mt-1 text-xs text-slate-500">{DOCUMENT_PRIVACY_NOTE}</p>

      {renderDocumentList("Your documents", mine)}
      {renderDocumentList(mySide === "buyer" ? "Seller's documents" : "Buyer's documents", theirs)}

      {canUpload && slotsLeft > 0 && (
        <div className="mt-4">
          <label className="block text-sm font-semibold text-slate-700">
            Add documents
            <input
              key={inputKey}
              multiple
              type="file"
              accept={DOCUMENT_ACCEPT}
              onChange={(event) => setFiles([...event.target.files])}
              className="mt-2 block w-full cursor-pointer text-sm font-normal text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
            />
          </label>
          <p className="mt-1 text-xs text-slate-500">
            A signed agreement (PDF) or screenshots. Up to {MAX_DEAL_DOCUMENTS_PER_SIDE} files in total from you, JPG, PNG, WEBP or PDF, 2 MB each.
            You can still add {slotsLeft}.
          </p>
          <button
            type="button"
            disabled={busy || files.length === 0}
            onClick={handleUpload}
            className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Uploading..."
              : files.length > 0
                ? `Upload ${files.length} file${files.length === 1 ? "" : "s"}`
                : "Upload"}
          </button>
        </div>
      )}

      {message && (
        <p className={`mt-3 rounded-lg p-2 text-sm ${message.type === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
