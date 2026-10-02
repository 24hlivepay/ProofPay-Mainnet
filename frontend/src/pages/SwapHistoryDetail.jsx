import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import CopyButton from "../components/CopyButton";
import { ActivityRecord, shortAddress } from "../components/ActivityRecord";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { getNetworkConfig } from "../config/network";
import { fetchActivity } from "../services/activity";

const EXTERNAL_ICON = (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);

function ReceiptRow({ label, href, children }) {
  const body = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-600" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{label}</span>
    </>
  );

  if (!href) {
    return <li className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">{body}{children}</li>;
  }

  return (
    <li>
      <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 hover:bg-slate-100">
        {body}
        <span className="text-slate-500">{EXTERNAL_ICON}</span>
      </a>
    </li>
  );
}

export default function SwapHistoryDetail() {
  const { clientId } = useParams();
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const [item, setItem] = useState(undefined); // undefined = loading, null = not found
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    setItem(undefined);
    try {
      const activity = await fetchActivity();
      setItem(activity.find((entry) => entry.clientId === clientId) || null);
    } catch (loadError) {
      setError(
        loadError.response?.status === 401
          ? "Connect your wallet to see this transaction."
          : "Could not load this transaction. Please try again."
      );
    }
  }, [clientId]);

  useEffect(() => {
    if (walletAddress) load();
  }, [walletAddress, load]);

  const destinationChain = item ? (item.kind === "swap" ? network.chainName : item.destinationChain) : "";
  // An address link is only known for Arc's own explorer.
  const walletExplorerUrl = item && destinationChain === network.chainName ? `${network.explorerBase}/address/${item.wallet}` : null;

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/swap-history", { replace: true })}
              aria-label="Back to History"
              className="-ml-2 rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 5l-7 7 7 7" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-slate-900">Transaction details</h1>
          </div>

          <div className="mt-4">
            {!walletAddress ? (
              <p className="rounded-xl bg-amber-50 p-4 text-amber-800">Connect your wallet first, then come back to this page.</p>
            ) : error ? (
              <div>
                <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>
                <button type="button" onClick={load} className="mt-3 text-sm font-semibold text-blue-600 hover:text-blue-700">Try again</button>
              </div>
            ) : item === undefined ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading...</p>
            ) : item === null ? (
              <div className="rounded-2xl border border-dashed border-slate-200 py-10 text-center">
                <p className="font-semibold text-slate-900">Transaction not found</p>
                <p className="mt-1 text-sm text-slate-500">It may be on another network, or older than your latest 50.</p>
              </div>
            ) : (
              <>
                <ul>
                  <ActivityRecord item={item} chainName={network.chainName} defaultOpen />
                </ul>

                <section className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <h2 className="text-base font-bold text-slate-900">Receipts</h2>
                  <ul className="mt-3 space-y-2">
                    {(item.links || []).map((link) => (
                      <ReceiptRow key={link.href} label={link.label} href={link.href} />
                    ))}
                    <ReceiptRow label={`Sent to wallet: ${shortAddress(item.wallet)}`}>
                      <CopyButton value={item.wallet} label="Copy wallet address" />
                      {walletExplorerUrl && (
                        <a href={walletExplorerUrl} target="_blank" rel="noreferrer" aria-label="View wallet on explorer" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-200">
                          {EXTERNAL_ICON}
                        </a>
                      )}
                    </ReceiptRow>
                  </ul>
                </section>

                <section className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-base font-bold text-slate-900">Reference ID</h2>
                    <CopyButton value={item.clientId} label="Copy reference ID" />
                  </div>
                  <p className="mt-2 break-all font-mono text-xs text-slate-600">{item.clientId}</p>
                  <p className="mt-2 text-xs text-slate-400">Quote this if you ask for help with this {item.kind}.</p>
                </section>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
