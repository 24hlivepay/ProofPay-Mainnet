import PrimaryButton from "./PrimaryButton";

// The "transaction complete" screen shown in place of the Swap / Bridge form,
// the way Jumper and Uniswap confirm a finished transaction: a large check,
// what was sent and what arrived, explorer links, and one button back to the
// form.
export default function SuccessPanel({ title, subtitle, rows = [], links = [], doneLabel = "Done", onDone }) {
  return (
    <div className="mt-6 text-center" role="status">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg viewBox="0 0 24 24" className="h-9 w-9 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </div>
      <h2 className="mt-4 text-2xl font-bold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}

      {rows.length > 0 && (
        <dl className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex items-baseline justify-between gap-4">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="text-right font-semibold text-slate-900">
                {row.value}
                {row.note && <span className="block text-xs font-normal text-slate-400">{row.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {links.length > 0 && (
        <ul className="mt-4 space-y-2 text-sm">
          {links.map((link) => (
            <li key={link.href} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-4 py-2.5">
              <span className="text-slate-600">
                <span className="text-green-600">✓</span> {link.label}
              </span>
              <a href={link.href} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">
                View on explorer ↗
              </a>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <PrimaryButton onClick={onDone}>{doneLabel}</PrimaryButton>
      </div>
    </div>
  );
}
