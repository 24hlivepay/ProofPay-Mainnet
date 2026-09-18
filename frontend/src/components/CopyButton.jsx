import { useState } from "react";

const VARIANT_CLASSES = {
  default: "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  light: "border-white/30 bg-white/10 text-white hover:bg-white/20",
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
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border px-2 py-1 text-sm leading-none transition ${VARIANT_CLASSES[variant]}`}
    >
      {copied ? "✅" : "📋"}
    </button>
  );
}
