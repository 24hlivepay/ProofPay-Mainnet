import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import AdminNav from "../components/AdminNav";
import CopyButton from "../components/CopyButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { useAdminGate } from "../hooks/useAdminGate";
import api from "../services/api";
import { shortenAddress } from "../utils/address";
import { getExplorerTxUrl } from "../config/network";

const STATUSES = [
  "",
  "Waiting Seller",
  "Seller Accepted",
  "Funds Locked",
  "Delivered",
  "Released",
  "Refunded",
  "Cancelled",
  "Disputed",
];

export default function AdminEscrows() {
  useAdminGate();
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [escrows, setEscrows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get("/admin/escrows", { params: { search, status } })
      .then((response) => {
        if (active) setEscrows(response.data.escrows || []);
      })
      .catch((requestError) => {
        if (active) {
          if (requestError.response?.status === 401 || requestError.response?.status === 403) {
            navigate("/admin/login", { replace: true, state: { redirectTo: "/admin/escrows" } });
            return;
          }
          setError(requestError.response?.data?.message || "Unable to load escrows.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [search, status, navigate]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">All escrows</h1>
        <p className="mt-2 text-slate-600">Search or filter every escrow on the current network.</p>

        <AdminNav />

        <div className="flex flex-wrap gap-3">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by escrow ID, wallet, or name"
            className="min-w-[260px] flex-1 rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-blue-500"
          />
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-blue-500"
          >
            {STATUSES.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "All statuses"}
              </option>
            ))}
          </select>
        </div>

        {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {loading ? (
            <p className="p-6 text-slate-500">Loading...</p>
          ) : escrows.length === 0 ? (
            <p className="p-6 text-slate-500">No matching escrows.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Escrow ID</th>
                  <th className="px-4 py-3">Buyer</th>
                  <th className="px-4 py-3">Seller</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {escrows.map((escrow) => (
                  <tr
                    key={escrow.escrowId}
                    onClick={() => setSelected(escrow)}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{escrow.escrowId}</td>
                    <td className="px-4 py-3">{escrow.buyerName || shortenAddress(escrow.buyerWallet)}</td>
                    <td className="px-4 py-3">{escrow.sellerName || shortenAddress(escrow.sellerWallet) || "—"}</td>
                    <td className="px-4 py-3">{escrow.amount} {escrow.assetSymbol}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={escrow.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(escrow.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {selected && <EscrowDetailModal escrow={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function StatusBadge({ status }) {
  const tone =
    status === "Disputed"
      ? "bg-red-100 text-red-700"
      : status === "Released" || status === "Refunded"
        ? "bg-green-100 text-green-700"
        : status === "Cancelled"
          ? "bg-slate-200 text-slate-600"
          : "bg-amber-100 text-amber-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{status}</span>;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function EscrowDetailModal({ escrow, onClose }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        style={{ maxHeight: "85vh" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold text-slate-900">{escrow.escrowId}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <Row label="Status" value={<StatusBadge status={escrow.status} />} />
          <Row label="Amount" value={`${escrow.amount} ${escrow.assetSymbol}`} />
          <Row label="Product / Service" value={escrow.productName} />
          <Row label="Buyer" value={escrow.buyerName} />
          <Row label="Buyer wallet" value={escrow.buyerWallet} copyable />
          <Row label="Seller" value={escrow.sellerName || "—"} />
          <Row label="Seller wallet" value={escrow.sellerWallet || "—"} copyable={Boolean(escrow.sellerWallet)} />
          <Row label="Locked for (expected seller)" value={escrow.expectedSeller || "—"} copyable={Boolean(escrow.expectedSeller)} />
          <Row label="Network" value={escrow.network} />
          <Row label="Created" value={formatDate(escrow.createdAt)} />
          {escrow.depositTransactionHash && (
            <Row
              label="Deposit tx"
              value={
                <a
                  className="text-blue-700 underline"
                  target="_blank"
                  rel="noreferrer"
                  href={getExplorerTxUrl(escrow.depositTransactionHash)}
                >
                  View on Arcscan ↗
                </a>
              }
            />
          )}
          {escrow.dispute && <Row label="Dispute" value={escrow.dispute.status} />}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, copyable = false }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="flex items-center gap-2 break-all text-right font-semibold text-slate-900">
        {value}
        {copyable && typeof value === "string" && <CopyButton value={value} />}
      </span>
    </div>
  );
}
