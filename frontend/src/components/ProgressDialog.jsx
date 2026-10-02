import { useEffect } from "react";
import PrimaryButton from "./PrimaryButton";

// The "your transaction is in progress" dialog, the way Jumper shows it: what
// is moving, then a vertical list of steps with the current one spinning, a
// check on each finished one, and a link to the explorer as soon as a step has
// a transaction. Presentational only -- the page decides each step's status.
//
// steps: [{ key, label, hint, status: "pending" | "active" | "done" | "error", href }]
// phase: "running" | "done" | "error"
function StepIcon({ status }) {
  if (status === "done") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 text-green-600">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-red-600">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  if (status === "active") {
    return <span className="block h-6 w-6 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden="true" />;
  }
  return <span className="block h-6 w-6 rounded-full border-2 border-slate-200" aria-hidden="true" />;
}

export default function ProgressDialog({
  open,
  phase,
  title,
  from,
  to,
  steps,
  message,
  note,
  closable,
  onClose,
  onRetry,
}) {
  useEffect(() => {
    if (!open || !closable) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closable, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="progress-dialog-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <h2 id="progress-dialog-title" className="text-xl font-bold text-slate-900">{title}</h2>
          {closable && (
            <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -mt-1 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</p>
            <p className="mt-1 truncate text-lg font-bold text-slate-900">{from.amount}</p>
            <p className="truncate text-xs text-slate-500">{from.chain}</p>
          </div>
          <span className="text-slate-400" aria-hidden="true">→</span>
          <div className="min-w-0 flex-1 text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</p>
            <p className="mt-1 truncate text-lg font-bold text-slate-900">{to.amount}</p>
            <p className="truncate text-xs text-slate-500">{to.chain}</p>
          </div>
        </div>

        <ol className="mt-5">
          {steps.map((step, index) => (
            <li key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepIcon status={step.status} />
                {index < steps.length - 1 && <span className="my-1 w-px flex-1 bg-slate-200" />}
              </div>
              <div className={`min-w-0 flex-1 ${index < steps.length - 1 ? "pb-5" : ""}`}>
                <p className={`text-sm font-semibold ${step.status === "pending" ? "text-slate-400" : "text-slate-900"}`}>{step.label}</p>
                {step.status === "active" && step.hint && <p className="mt-0.5 text-xs text-slate-500">{step.hint}</p>}
                {step.href && (
                  <a href={step.href} target="_blank" rel="noreferrer" className="mt-0.5 inline-block text-xs font-semibold text-blue-700 hover:underline">
                    View on explorer ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>

        {phase === "running" && note && <p className="mt-4 text-center text-xs text-slate-500">{note}</p>}

        {phase === "done" && (
          <div className="mt-5">
            <p className="mb-3 text-center text-sm font-semibold text-green-700">{message}</p>
            <PrimaryButton onClick={onClose}>Done</PrimaryButton>
          </div>
        )}

        {phase === "error" && (
          <div className="mt-5">
            <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{message}</p>
            <div className="mt-3 space-y-2">
              {onRetry && <PrimaryButton onClick={onRetry}>Retry</PrimaryButton>}
              <button type="button" onClick={onClose} className="w-full rounded-xl py-3 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
