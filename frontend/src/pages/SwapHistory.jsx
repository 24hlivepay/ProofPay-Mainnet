import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { getNetworkConfig } from "../config/network";
import { fetchActivity } from "../services/activity";
import { ActivityRecord } from "../components/ActivityRecord";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "swap", label: "Swaps" },
  { key: "bridge", label: "Bridges" },
];

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
                {visible.map((item) => <ActivityRecord key={item.clientId} item={item} chainName={network.chainName} onOpen={() => navigate(`/swap-history/${item.clientId}`)} />)}
              </ul>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
