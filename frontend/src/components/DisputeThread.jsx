import { useState } from "react";
import { openEvidence, readEvidenceFiles } from "../utils/evidence";

const SENDER_STYLES = {
  admin: { label: "ProofPay admin", box: "border-blue-200 bg-blue-50", name: "text-blue-800" },
  buyer: { label: "Buyer", box: "border-slate-200 bg-white", name: "text-slate-700" },
  seller: { label: "Seller", box: "border-slate-200 bg-white", name: "text-slate-700" },
};

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

// onSend(text, files) -- files is only populated when allowFiles is set.
// escrowId is needed to open message attachments.
export default function DisputeThread({ messages = [], onSend, placeholder, sendLabel = "Send message", collapseAfter, escrowId, allowFiles = false }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const canCollapse = Number.isFinite(collapseAfter) && messages.length > collapseAfter;
  const visibleMessages = canCollapse && !expanded ? messages.slice(0, collapseAfter) : messages;
  const canSend = Boolean(text.trim() || files.length > 0) && !sending;

  async function handleSend() {
    if (!canSend) return;

    try {
      setSending(true);
      setFileError("");
      const encoded = files.length > 0 ? await readEvidenceFiles(files) : [];
      await onSend(text.trim(), encoded);
      setText("");
      setFiles([]);
      setFileInputKey((key) => key + 1);
    } catch (error) {
      // Parents surface server errors themselves; a local read error (file
      // too large) has no other place to show.
      if (!error.response) setFileError(error.message || "Unable to send.");
    } finally {
      setSending(false);
    }
  }

  async function handleOpen(file) {
    try {
      setFileError("");
      await openEvidence(escrowId, file);
    } catch (error) {
      setFileError(error.message);
    }
  }

  return (
    <div className="mt-4">
      <h3 className="font-bold text-slate-900">Conversation</h3>
      {messages.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No messages yet.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {visibleMessages.map((message, index) => {
            const style = SENDER_STYLES[message.from] || SENDER_STYLES.buyer;

            return (
              <li key={index} className={`rounded-xl border p-3 text-sm ${style.box}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className={`font-semibold ${style.name}`}>{style.label}</span>
                  <span className="text-xs text-slate-500">{formatTime(message.sentAt)}</span>
                </div>
                {message.text && <p className="mt-1 whitespace-pre-wrap text-slate-800">{message.text}</p>}
                {message.evidence?.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {message.evidence.map((file) => (
                      <li key={file.id}>
                        <button type="button" onClick={() => handleOpen(file)} className="text-left text-blue-700 underline">
                          📎 {file.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="mt-2 text-sm font-semibold text-blue-700 hover:text-blue-800"
        >
          {expanded ? "See less" : `See more (${messages.length - collapseAfter} more)`}
        </button>
      )}

      {fileError && <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm text-red-700">{fileError}</p>}

      {onSend && (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder={placeholder}
            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
          />
          {allowFiles && (
            <div className="mt-2">
              <input
                key={fileInputKey}
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf"
                type="file"
                onChange={(event) => setFiles([...event.target.files])}
                className="block w-full cursor-pointer text-sm text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Proof is optional: up to 5 JPG, PNG, WEBP, or PDF files, 2 MB each. Buyer, seller and admin can all open it, and it is kept permanently with the case record.
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="mt-2 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sending ? "Sending..." : sendLabel}
          </button>
        </div>
      )}
    </div>
  );
}
