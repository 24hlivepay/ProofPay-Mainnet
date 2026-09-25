import { useRef, useState } from "react";
import { openEvidence, readEvidenceFiles } from "../utils/evidence";
import { applyMention, filterParties, findMentionQuery, insertMentionAtCaret, splitMentions } from "../utils/disputeMentions";

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
// parties (from buildDisputeParties) + selfKey turn on "@" addressing: typing
// "@" or tapping a name inserts "@Name (Role)" for the other two people, and
// mentions are highlighted in every message.
export default function DisputeThread({ messages = [], onSend, placeholder, sendLabel = "Send message", collapseAfter, escrowId, allowFiles = false, parties, selfKey }) {
  const textareaRef = useRef(null);
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [fileError, setFileError] = useState("");
  const [sending, setSending] = useState(false);
  const canCollapse = Number.isFinite(collapseAfter) && messages.length > collapseAfter;
  const visibleMessages = canCollapse && !expanded ? messages.slice(0, collapseAfter) : messages;
  const canSend = Boolean(text.trim() || files.length > 0) && !sending;

  const mention = parties ? findMentionQuery(text, caret) : null;
  const suggestions = mention && !menuDismissed ? filterParties(parties, selfKey, mention.query) : [];
  const quickParties = parties ? filterParties(parties, selfKey) : [];

  function place(nextText, nextCaret) {
    setText(nextText);
    setCaret(nextCaret);
    setActiveIndex(0);
    setMenuDismissed(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function pickSuggestion(party) {
    const next = applyMention(text, caret, mention.start, party.insert);
    place(next.text, next.caret);
  }

  function insertQuick(party) {
    const at = textareaRef.current?.selectionStart ?? text.length;
    const next = insertMentionAtCaret(text, at, party.insert);
    place(next.text, next.caret);
  }

  function handleKeyDown(event) {
    if (suggestions.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      pickSuggestion(suggestions[Math.min(activeIndex, suggestions.length - 1)]);
    } else if (event.key === "Escape") {
      setMenuDismissed(true);
    }
  }

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
                {message.text && (
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">
                    {splitMentions(message.text, parties || []).map((piece, pieceIndex) =>
                      piece.mention
                        ? <span key={pieceIndex} className="font-semibold text-blue-700">{piece.text}</span>
                        : piece.text
                    )}
                  </p>
                )}
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
          {quickParties.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500">Address to:</span>
              {quickParties.map((party) => (
                <button
                  key={party.key}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertQuick(party)}
                  className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-700 hover:bg-blue-100"
                >
                  {party.insert}
                </button>
              ))}
            </div>
          )}
          <div className="relative">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCaret(event.target.selectionStart ?? event.target.value.length);
                setActiveIndex(0);
                setMenuDismissed(false);
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={(event) => setCaret(event.target.selectionStart ?? text.length)}
              onClick={(event) => setCaret(event.target.selectionStart ?? text.length)}
              rows={2}
              placeholder={placeholder}
              className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
            />
            {suggestions.length > 0 && (
              <ul role="listbox" className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                {suggestions.map((party, index) => (
                  <li key={party.key} role="option" aria-selected={index === activeIndex}>
                    <button
                      type="button"
                      onMouseDown={(event) => { event.preventDefault(); pickSuggestion(party); }}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${index === activeIndex ? "bg-blue-50" : "hover:bg-slate-50"}`}
                    >
                      <span className="font-semibold text-slate-900">{party.name || party.role}</span>
                      {party.name && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{party.role}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
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
