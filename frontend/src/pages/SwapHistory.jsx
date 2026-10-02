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

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function TypeIcon({ kind }) {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
      {kind === "swap" ? (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 4v14M7 18l-3-3M7 18l3-3M17 20V6M17 6l-3 3M17 6l3 3" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17h18M3 17l4-4M3 17l4 4M21 7H3M21 7l-4-4M21 7l-4 4" />
        </svg>
      )}
    </span>
  );
}

function HistoryRow({ item, chainName }) {
  const isSwap = item.kind === "swap";
  return (
    <li className="flex gap-3 rounded-2xl border border-slate-200 p-4">
      <TypeIcon kind={item.kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isSwap ? "Swap" : "Bridge"}</p>
          <p className="shrink-0 text-xs text-slate-400">{formatTime(item.createdAt)}</p>
        </div>
        {isSwap ? (
          <>
            <p className="mt-1 font-bold text-slate-900">
              {item.amountIn} {item.tokenIn} <span className="text-slate-400">→</span> {item.amountOut ? `${item.amountOut} ` : ""}{item.tokenOut}
            </p>
            <p className="text-sm text-slate-500">on {chainName}</p>
          </>
        ) : (
          <>
            <p className="mt-1 font-bold text-slate-900">{item.sent} {item.token}</p>
            <p className="text-sm text-slate-500">
              {item.sourceChain} <span className="text-slate-400">→</span> {item.destinationChain}
            </p>
            {item.received && <p className="text-sm text-slate-500">{item.received} {item.token} arrived</p>}
          </>
        )}
        {item.links?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {item.links.map((link) => (
              <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">
                {link.label} ↗
              </a>
            ))}
          </div>
        )}
      </div>
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
                {visible.map((item) => <HistoryRow key={item.clientId} item={item} chainName={network.chainName} />)}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
