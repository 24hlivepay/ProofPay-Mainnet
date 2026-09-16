import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";

export default function CompletedOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const [orders, setOrders] = useState([]);
  const role = location.state?.role === "seller" ? "seller" : "buyer";
  const isSellerRole = role === "seller";

  const loadOrders = useCallback(async () => {
    const response = await api.get("/escrows", {
      params: { category: "completed", wallet: getConnectedWallet(), role },
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
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-bold text-slate-900">{isSellerRole ? "Payments Received" : "Completed Purchases"}</h1><p className="mt-2 text-slate-600">{isSellerRole ? "USDC payments released to your seller wallet." : "USDC payments successfully released to sellers."}</p></div><button onClick={() => navigate(isSellerRole ? "/dashboard/selling" : "/dashboard/buying")} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">← {isSellerRole ? "Selling Escrows" : "Buying Escrows"}</button></div>
        <div className="mt-8 space-y-5">
          {orders.length === 0 ? <EmptyState seller={isSellerRole} /> : orders.map((order) => <OrderCard key={order.escrowId} order={order} seller={isSellerRole} onViewDispute={() => navigate("/dispute/respond", { state: { order } })} />)}
        </div>
      </main>
    </div>
  );
}

function OrderCard({ order, seller, onViewDispute }) {
  const resolution = order.dispute?.resolution;
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${resolution ? "border-amber-200" : "border-green-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-slate-900">{order.escrowId}</h2><p className="mt-2 text-slate-600">{order.productName || "Escrow transaction"}</p></div>
        <span className={`rounded-full px-4 py-2 text-sm font-bold ${resolution ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
          {resolution ? "Resolved by ProofPay admin" : seller ? "Payment Received" : "Payment Released"}
        </span>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label={seller ? "Buyer" : "Seller"} value={seller ? order.buyerName : order.sellerName} />
        <Detail label={seller ? "Amount received" : "Amount paid"} value={`${order.amount} ${order.assetSymbol || "USDC"}`} />
        <Detail label="Created" value={formatDate(order.createdAt)} />
        <Detail label="Completed" value={formatDate(order.releasedAt || resolution?.resolvedAt)} />
      </div>

      {resolution && (
        <div className="mt-6 rounded-2xl border border-amber-100 bg-amber-50 p-5">
          <p className="font-bold text-slate-900">This order was settled through a dispute</p>
          <p className="mt-1 text-sm text-slate-600">{resolution.buyerAmount} {order.assetSymbol} to buyer · {resolution.sellerAmount} {order.assetSymbol} to seller.</p>
          <button onClick={onViewDispute} className="mt-4 rounded-xl bg-white px-4 py-2 text-sm font-bold text-amber-700 shadow-sm hover:bg-amber-100">View admin decision</button>
        </div>
      )}

      {(order.depositTransactionHash || order.releaseTransactionHash) && (
        <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <p className="font-bold text-slate-900">Blockchain proof</p>
          <p className="mt-1 text-sm text-slate-600">Open either transaction on Arcscan to verify this escrow's on-chain history.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {order.depositTransactionHash && <ArcscanLink label={`View ${order.assetSymbol || "USDC"} lock`} hash={order.depositTransactionHash} />}
            {order.releaseTransactionHash && <ArcscanLink label="View payment release" hash={order.releaseTransactionHash} />}
          </div>
        </div>
      )}
    </article>
  );
}

function Detail({ label, value }) { return <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900">{value || "—"}</p></div>; }
function ArcscanLink({ label, hash }) { return <a href={`https://testnet.arcscan.app/tx/${hash}`} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm transition hover:bg-blue-100">{label} ↗</a>; }
function EmptyState({ seller }) { return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><div className="text-4xl">✅</div><h2 className="mt-4 text-xl font-bold text-slate-900">{seller ? "No payments received" : "No completed purchases"}</h2><p className="mt-2 text-sm text-slate-600">Released escrow payments will appear here.</p></div>; }

function formatDate(timestamp) {
  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
