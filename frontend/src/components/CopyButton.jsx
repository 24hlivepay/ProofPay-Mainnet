import { useState } from "react";

const VARIANT_CLASSES = {
  default: "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
  light: "text-white/70 hover:bg-white/10 hover:text-white",
};

export default function CopyButton({ value, label = "Copy address", variant = "default" }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy(event) {
    event.stopPropagation();
    if (!value) return;

    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("Unable to copy. Please copy it manually.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      className={`inline-flex shrink-0 items-center justify-center rounded-md p-1.5 transition ${VARIANT_CLASSES[variant]}`}
    >
      {copied ? (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}
