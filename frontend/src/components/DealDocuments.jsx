import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import {
  DOCUMENT_ACCEPT,
  checkDocumentFiles,
  fileProblem,
  formatFileSize,
  mergeSelectedFiles,
  openDealDocument,
  removeDealDocument,
  uploadDealDocuments,
} from "../utils/dealDocuments";

export const DOCUMENT_PRIVACY_LINE =
  "Only you and the other party can open these files, not the ProofPay admin. Never upload passwords or keys.";

// One clear "Choose files" button. The native file box is hidden, so there is no
// "No file chosen" text (the page shows its own list of what was chosen).
export function ChooseFilesButton({ onChoose }) {
  return (
    <label className="mt-3 inline-block cursor-pointer rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white focus-within:ring-2 focus-within:ring-blue-300 hover:bg-blue-700">
      Choose files
      <input
        multiple
        type="file"
        accept={DOCUMENT_ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const chosen = [...event.target.files];
          event.target.value = "";
          onChoose(chosen);
        }}
      />
    </label>
  );
}

// The files chosen so far, each with a Remove button and a red note when it cannot
// be uploaded (too big, wrong type).
export function SelectedFileList({ files, onRemove, maxFiles }) {
  if (files.length === 0) return null;
  return (
    <div className="mt-3 text-sm">
      <ul className="space-y-1">
        {files.map((file) => {
          const problem = fileProblem(file);
          return (
            <li key={`${file.name}:${file.size}`} className="flex items-start justify-between gap-3">
              <span className="break-all">
                {file.name} <span className="text-xs text-slate-500">{formatFileSize(file.size)}</span>
                {problem && <span className="ml-2 text-xs font-semibold text-red-700">{problem}</span>}
              </span>
              <button type="button" onClick={() => onRemove(file)} className="shrink-0 text-xs font-semibold text-red-600 underline">
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {files.length > maxFiles && (
        <p className="mt-1 text-xs text-red-700">
          You can attach {maxFiles} file{maxFiles === 1 ? "" : "s"}. Remove some to continue.
        </p>
      )}
    </div>
  );
}

// The deal's agreement / proof documents for the buyer or the seller viewing the
// page: both parties' files, in every state of the deal (upload is offered only
// while the deal is open, and never when `readOnly`). A page only needs the escrow
// id. It renders nothing for anyone who is not the buyer or the seller of this deal.
// If the sign-in has expired it says so and offers a button, instead of hiding.
export default function DealDocuments({ escrowId, readOnly = false }) {
  const [info, setInfo] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | signin | hidden
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  // Without `reauth`, an expired session must not pop up a wallet signature on its
  // own; the user presses the button for that.
  const load = useCallback(async ({ reauth = false } = {}) => {
    try {
      const response = await api.get(`/escrow/${escrowId}/documents`, reauth ? {} : { _skipReauth: true });
      setInfo(response.data);
      setState("ready");
    } catch (error) {
      setState(error.response?.status === 401 ? "signin" : "hidden");
    }
  }, [escrowId]);

  useEffect(() => {
    if (escrowId) load();
  }, [escrowId, load]);

  if (state === "signin") {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="font-bold text-slate-900">Agreement &amp; proof</h3>
        <p className="mt-1 text-xs text-slate-500">Sign in with your wallet again to see this deal's documents.</p>
        <button
          type="button"
          onClick={() => load({ reauth: true })}
          className="mt-3 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Sign in to view documents
        </button>
      </div>
    );
  }

  if (state !== "ready" || !info) return null;

  const mySide = info.side;
  const mine = info.documents.filter((doc) => doc.side === mySide);
  const theirs = info.documents.filter((doc) => doc.side !== mySide);
  const canUpload = !readOnly && info.canUpload;
  const slotsLeft = info.slotsLeft;

  async function handleOpen(file) {
    try {
      setMessage(null);
      await openDealDocument(escrowId, file);
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    }
  }

  async function handleRemove(file) {
    const ok = window.confirm(
      `Remove ${file.name}?\n\nThe file is deleted. The other party will still see that it was removed, and when. You can then add a different file.`
    );
    if (!ok) return;
    try {
      setMessage(null);
      await removeDealDocument(escrowId, file);
      await load();
      setMessage({ type: "success", text: `${file.name} was removed. You can add another file.` });
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
    setBusy(false);
    setMessage(
      failed.length > 0
        ? { type: "error", text: `Could not upload: ${failed.map((item) => `${item.name} (${item.message})`).join("; ")}` }
        : { type: "success", text: "Uploaded." }
    );
  }

  function renderDocumentList(title, documents, { removable = false } = {}) {
    return (
      <div className="mt-3">
        <p className="text-sm font-semibold text-slate-700">{title}</p>
        {documents.length === 0 ? (
          <p className="mt-1 text-sm text-slate-500">None yet.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {documents.map((doc) =>
              doc.removedAt ? (
                <li key={doc.id} className="text-slate-500">
                  <span className="line-through">{doc.name}</span>
                  <span className="ml-2 text-xs">
                    removed by {doc.removedBy === mySide ? "you" : doc.removedBy} on {new Date(doc.removedAt).toLocaleString()}
                  </span>
                </li>
              ) : (
                <li key={doc.id} className="flex items-start justify-between gap-3">
                  <span className="break-all">
                    <button type="button" onClick={() => handleOpen(doc)} className="text-left text-blue-700 underline">
                      {doc.name}
                    </button>
                    <span className="ml-2 text-xs text-slate-500">{formatFileSize(doc.size)}</span>
                  </span>
                  {removable && (
                    <button type="button" onClick={() => handleRemove(doc)} className="shrink-0 text-xs font-semibold text-red-600 underline">
                      Remove
                    </button>
                  )}
                </li>
              )
            )}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="font-bold text-slate-900">Agreement &amp; proof <span className="font-normal text-slate-500">(optional)</span></h3>
      <p className="mt-1 text-xs text-slate-500">{DOCUMENT_PRIVACY_LINE}</p>

      {renderDocumentList("Your documents", mine, { removable: canUpload })}
      {renderDocumentList(mySide === "buyer" ? "Seller's documents" : "Buyer's documents", theirs)}

      {canUpload && slotsLeft > 0 && (
        <div className="mt-4">
          <p className="text-sm font-semibold text-slate-700">Add documents</p>
          <p className="mt-1 text-xs text-slate-500">
            PDF, JPG, PNG or WEBP, 2 MB each. You can add {slotsLeft} more.
          </p>
          <ChooseFilesButton onChoose={(chosen) => setFiles((current) => mergeSelectedFiles(current, chosen))} />
          <SelectedFileList
            files={files}
            maxFiles={slotsLeft}
            onRemove={(file) => setFiles((current) => current.filter((item) => item !== file))}
          />
          <button
            type="button"
            disabled={busy || files.length === 0}
            onClick={handleUpload}
            className="mt-3 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
