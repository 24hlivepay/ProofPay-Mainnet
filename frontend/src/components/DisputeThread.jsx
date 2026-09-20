import { useState } from "react";

const SENDER_STYLES = {
  admin: { label: "ProofPay admin", box: "border-blue-200 bg-blue-50", name: "text-blue-800" },
  buyer: { label: "Buyer", box: "border-slate-200 bg-white", name: "text-slate-700" },
  seller: { label: "Seller", box: "border-slate-200 bg-white", name: "text-slate-700" },
};

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function DisputeThread({ messages = [], onSend, placeholder, sendLabel = "Send message", collapseAfter }) {
  const [text, setText] = useState("");
  const [expanded, setExpanded] = useState(false);
  const canCollapse = Number.isFinite(collapseAfter) && messages.length > collapseAfter;
  const visibleMessages = canCollapse && !expanded ? messages.slice(0, collapseAfter) : messages;
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!text.trim() || sending) return;

    try {
      setSending(true);
      await onSend(text.trim());
      setText("");
    } finally {
      setSending(false);
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
                <p className="mt-1 whitespace-pre-wrap text-slate-800">{message.text}</p>
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

      {onSend && (
        <div className="mt-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder={placeholder}
            className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="mt-2 w-full rounded-xl bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {sending ? "Sending..." : sendLabel}
          </button>
        </div>
      )}
    </div>
  );
}
