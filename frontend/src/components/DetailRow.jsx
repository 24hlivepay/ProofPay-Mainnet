// One "label ... value" line in the Swap / Bridge summary box, with an
// optional small note under the value.
export default function DetailRow({ label, value, note }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-900">
        {value}
        {note && <span className="block text-xs font-normal text-slate-400">{note}</span>}
      </dd>
    </div>
  );
}
