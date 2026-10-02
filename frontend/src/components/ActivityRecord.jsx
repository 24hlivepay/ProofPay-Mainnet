import { useState } from "react";
import { ChainLogo, TokenLogo } from "./Logos";

export function shortAddress(address) {
  return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// 1 USDC = 0.889 EURC, from what was paid and what the quote said arrives.
function exchangeRate(item) {
  const paid = Number(item.amountIn);
  const got = Number(item.amountOut);
  if (!(paid > 0) || !(got > 0)) return null;
  return `1 ${item.tokenIn} ≈ ${(got / paid).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${item.tokenOut}`;
}

function DetailLine({ label, value, note }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-900">
        {value}
        {note && <span className="block text-xs font-normal text-slate-400">{note}</span>}
      </dd>
    </div>
  );
}

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// The token's logo with its chain's logo on the corner, the way Jumper shows
// which chain a token is on.
function TokenBadge({ symbol, chain }) {
  return (
    <span className="relative flex h-11 w-11 shrink-0" aria-hidden="true">
      <span className="h-11 w-11 overflow-hidden rounded-full shadow-sm ring-2 ring-white">
        <TokenLogo symbol={symbol} />
      </span>
      <span className="absolute -bottom-1.5 -right-1.5 h-6 w-6 overflow-hidden rounded-full ring-2 ring-white">
        <ChainLogo chain={chain} />
      </span>
    </span>
  );
}

// One side of a swap or bridge: the amount, then which token on which chain.
function Side({ label, amount, symbol, chain, trailing }) {
  return (
    <div className="flex items-center gap-3">
      <TokenBadge symbol={symbol} chain={chain} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-xl font-bold text-slate-900">{amount ?? "—"}</p>
        <p className="truncate text-sm text-slate-500">
          <span className="font-semibold text-slate-700">{symbol}</span> on {chain}
        </p>
      </div>
      {trailing}
    </div>
  );
}

// One swap or bridge as a card: tag and date, From and To (amount, token on
// its chain, chain mark), and a chevron that opens the quick details. In the
// list the card as a whole opens the full transaction page (onOpen); on that
// page the same card is shown without it.
export function ActivityRecord({ item, chainName, onOpen, defaultOpen = false, footer = null }) {
  const [open, setOpen] = useState(defaultOpen);
  const isSwap = item.kind === "swap";
  const from = isSwap
    ? { amount: item.amountIn, symbol: item.tokenIn, chain: chainName }
    : { amount: item.sent, symbol: item.token, chain: item.sourceChain };
  const to = isSwap
    ? { amount: item.amountOut, symbol: item.tokenOut, chain: chainName }
    : { amount: item.received, symbol: item.token, chain: item.destinationChain };
  const rate = isSwap ? exchangeRate(item) : null;
  const took = formatDuration(item.durationSec);

  const summary = (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-blue-700 shadow-sm">{isSwap ? "Swap" : "Bridge"}</span>
        <p className="text-xs text-slate-400">{formatDate(item.createdAt)} · {formatTime(item.createdAt)}</p>
      </div>

      <div className="mt-4">
        <Side label="From" {...from} />
        <div className="my-1 ml-[18px] flex h-6 items-center" aria-hidden="true">
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-blue-200 bg-white text-slate-400">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </span>
        </div>
        <Side
          label="To"
          {...to}
          trailing={(
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
              aria-expanded={open}
              aria-label={open ? "Hide details" : "Show details"}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm hover:bg-slate-100"
            >
              <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
          )}
        />
      </div>
    </>
  );

  return (
    <li className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
      {onOpen ? (
        <div
          role="link"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen();
            }
          }}
          className="cursor-pointer rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {summary}
        </div>
      ) : summary}

      {open && (
        <div className="mt-4 border-t border-blue-200 pt-3">
          <dl className="space-y-2">
            <DetailLine
              label="Your wallet"
              value={shortAddress(item.wallet)}
              note={isSwap ? `swapped on ${to.chain}` : `source and destination: sent from ${from.chain}, received on ${to.chain}`}
            />
            {(item.fees || []).map((fee) => (
              <DetailLine key={`${fee.label}-${fee.token}`} label={fee.label} value={`${fee.amount} ${fee.token}`} />
            ))}
            {rate && <DetailLine label="Exchange rate" value={rate} />}
            {took && <DetailLine label="Time taken" value={took} />}
          </dl>
          {footer}
        </div>
      )}
    </li>
  );
}
