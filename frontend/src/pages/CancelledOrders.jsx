import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";

export default function CancelledOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const role = location.state?.role === "seller" ? "seller" : "buyer";
  const isSellerRole = role === "seller";

  const loadOrders = useCallback(async () => {
    const response = await api.get("/escrows", {
      params: { category: "cancelled", wallet: getConnectedWallet(), role },
    });
    setOrders(response.data.escrows || []);
  }, [role]);

  useEffect(() => {
    loadOrders().catch(() => setOrders([]));
  }, [loadOrders]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-slate-900">{isSellerRole ? "Cancelled Sales" : "Cancelled Purchases"}</h1><p className="mt-2 text-slate-600">Escrows cancelled before any selected asset was deposited.</p></div><button onClick={() => navigate(isSellerRole ? "/dashboard/selling" : "/dashboard/buying")} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">← {isSellerRole ? "Selling Escrows" : "Buying Escrows"}</button></div>
        <div className="mt-8 space-y-5">
          {orders.length === 0 ? <EmptyState seller={isSellerRole} /> : orders.map((order) => <article key={order.escrowId} className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-bold text-slate-900">{order.escrowId}</h2><p className="mt-2 text-slate-600">{order.productName || "Escrow transaction"}</p></div><span className="rounded-full bg-red-100 px-4 py-2 text-sm font-bold text-red-700">Cancelled</span></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><Detail label={isSellerRole ? "Buyer" : "Seller"} value={isSellerRole ? order.buyerName : order.sellerName} /><Detail label="Amount not deposited" value={`${order.amount} ${order.assetSymbol || "USDC"}`} /><Detail label="Reason" value={order.cancellationReason || "Cancelled"} /></div></article>)}
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }) { return <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value || "—"}</p></div>; }
function EmptyState({ seller }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><div className="text-4xl">✖️</div><h2 className="mt-4 text-xl font-bold text-slate-900">{seller ? "No cancelled sales" : "No cancelled purchases"}</h2><p className="mt-2 text-sm text-slate-600">Cancelled records will appear here.</p></div>; }
