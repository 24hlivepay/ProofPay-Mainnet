import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";

export default function MyDisputes() {
  const navigate = useNavigate();
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const role = location.state?.role === "seller" ? "seller" : "buyer";
  const isSellerRole = role === "seller";

  const loadOrders = useCallback(async () => {
    try {
      const response = await api.get("/escrows", {
        params: { category: "disputes", wallet: getConnectedWallet(), role },
      });
      const sorted = [...(response.data.escrows || [])].sort((a, b) => {
        const aTime = a.dispute?.resolution?.resolvedAt || a.dispute?.openedAt || 0;
        const bTime = b.dispute?.resolution?.resolvedAt || b.dispute?.openedAt || 0;
        return bTime - aTime;
      });
      setOrders(sorted);
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => { loadOrders().catch(() => setOrders([])); }, [loadOrders]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">My Disputes</h1>
            <p className="mt-2 text-slate-600">{isSellerRole ? "Disputes opened on your sales, open or resolved." : "Disputes opened on your purchases, open or resolved."}</p>
          </div>
          <button onClick={() => navigate(isSellerRole ? "/dashboard/selling" : "/dashboard/buying")} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">← {isSellerRole ? "Selling Escrows" : "Buying Escrows"}</button>
        </div>

        <div className="mt-8 space-y-5">
          {!loading && orders.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="text-4xl">⚖️</div>
              <h2 className="mt-5 text-2xl font-bold text-slate-900">No disputes</h2>
              <p className="mt-2 text-slate-600">Any dispute on your escrows, open or resolved, will appear here.</p>
            </div>
          )}

          {orders.map((order) => <DisputeCard key={order.escrowId} order={order} onView={() => navigate("/dispute/respond", { state: { order } })} />)}
        </div>
      </main>
    </div>
  );
}

function DisputeCard({ order, onView }) {
  const dispute = order.dispute;
  const resolved = Boolean(dispute.resolution);
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${resolved ? "border-amber-200" : "border-red-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-slate-900">{order.escrowId}</h2><p className="mt-2 text-slate-600">{order.amount} {order.assetSymbol || "USDC"} · {dispute.reason}</p></div>
        <span className={`rounded-full px-4 py-2 text-sm font-bold ${resolved ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
          {resolved ? "Resolved" : "Awaiting resolution"}
        </span>
      </div>
      <p className="mt-3 text-sm text-slate-500">Opened {formatDate(dispute.openedAt)}{resolved ? ` · Resolved ${formatDate(dispute.resolution.resolvedAt)}` : ""}</p>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Buyer</p><p className="font-semibold text-slate-900">{order.buyerName || "—"}</p><p className="break-all text-xs text-slate-500">{order.buyerWallet}</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Seller</p><p className="font-semibold text-slate-900">{order.sellerName || "—"}</p><p className="break-all text-xs text-slate-500">{order.sellerWallet}</p></div>
      </div>
      <button onClick={onView} className="mt-5 w-full rounded-xl bg-slate-800 py-3 font-semibold text-white hover:bg-slate-900">View case</button>
    </article>
  );
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
