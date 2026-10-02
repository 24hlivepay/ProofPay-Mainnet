import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { getNetworkConfig } from "../config/network";
import { fetchActivity } from "../services/activity";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "swap", label: "Swaps" },
  { key: "bridge", label: "Bridges" },
];

const GLYPHS = { USDC: "$", EURC: "€", cirBTC: "₿" };

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function TokenBadge({ symbol }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-lg font-bold text-blue-600 shadow-sm" aria-hidden="true">
      {GLYPHS[symbol] || String(symbol).slice(0, 1)}
    </span>
  );
}

// One side of a swap or bridge: the amount, then which token on which chain.
function Side({ label, amount, symbol, chain, trailing }) {
  return (
    <div className="flex items-center gap-3">
      <TokenBadge symbol={symbol} />
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

function HistoryCard({ item, chainName }) {
  const [open, setOpen] = useState(false);
  const isSwap = item.kind === "swap";
  const from = isSwap
    ? { amount: item.amountIn, symbol: item.tokenIn, chain: chainName }
    : { amount: item.sent, symbol: item.token, chain: item.sourceChain };
  const to = isSwap
    ? { amount: item.amountOut, symbol: item.tokenOut, chain: chainName }
    : { amount: item.received, symbol: item.token, chain: item.destinationChain };
  const hasLinks = item.links?.length > 0;

  return (
    <li className="rounded-2xl border border-blue-200 bg-blue-50 p-4 shadow-sm">
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
          trailing={hasLinks && (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
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

      {open && hasLinks && (
        <ul className="mt-4 space-y-2 border-t border-blue-200 pt-3">
          {item.links.map((link) => (
            <li key={link.href} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-600"><span className="text-green-600">✓</span> {link.label}</span>
              <a href={link.href} target="_blank" rel="noreferrer" className="shrink-0 text-xs font-semibold text-blue-700 hover:underline">
                View on explorer ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function SwapHistory() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const [filter, setFilter] = useState("all");
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setItems(null);
    try {
      setItems(await fetchActivity());
    } catch (loadError) {
      setError(
        loadError.response?.status === 401
          ? "Connect your wallet to see your history."
          : "Could not load your history. Please try again."
      );
    }
  }, []);

  useEffect(() => {
    if (walletAddress) load();
  }, [walletAddress, load]);

  const visible = (items || []).filter((item) => filter === "all" || item.kind === filter);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/swap", { replace: true })}
              aria-label="Back to Swap"
              className="-ml-2 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-slate-900">History</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">Your swaps and bridges on {network.chainName}.</p>

          <div className="mt-4 flex gap-2" role="tablist" aria-label="Filter history">
            {FILTERS.map((option) => (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={filter === option.key}
                onClick={() => setFilter(option.key)}
                className={
                  filter === option.key
                    ? "rounded-full bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white"
                    : "rounded-full bg-slate-100 px-4 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            {!walletAddress ? (
              <p className="rounded-xl bg-amber-50 p-4 text-amber-800">Connect your wallet first, then come back to this page.</p>
            ) : error ? (
              <div>
                <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
                <button type="button" onClick={load} className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">Try again</button>
              </div>
            ) : items === null ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading your history...</p>
            ) : visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                <p className="font-semibold text-slate-900">Nothing here yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  {filter === "all" ? "Swaps and bridges you make from now on will show up here." : `No ${filter === "swap" ? "swaps" : "bridges"} yet.`}
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {visible.map((item) => <HistoryCard key={item.clientId} item={item} chainName={network.chainName} />)}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
