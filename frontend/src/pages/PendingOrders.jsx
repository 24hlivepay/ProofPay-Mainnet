import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";
import { useEscrow } from "../context/EscrowContext";

const PENDING_EXPIRY_MS = 12 * 60 * 60 * 1000;

export default function PendingOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setEscrowData } = useEscrow();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const role = location.state?.role === "seller" ? "seller" : "buyer";
  const isSellerRole = role === "seller";

  const loadOrders = useCallback(async () => {
    try {
      setError("");
      const wallet = getConnectedWallet();
      const response = await api.get("/escrows", {
        params: { category: "pending", wallet, role },
      });
      setOrders(response.data.escrows || []);
    } catch {
      setError("Unable to load pending orders.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    const interval = setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);

      const hasExpiredOrder = orders.some(
        (order) => getExpiryTime(order) <= currentTime
      );

      if (hasExpiredOrder) {
        loadOrders();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [loadOrders, orders]);

  async function cancelOrder(order) {
    if (!window.confirm(`Cancel ${order.escrowId}? No funds have been locked yet.`)) {
      return;
    }

    try {
      await api.post(`/escrow/${order.escrowId}/cancel`, {
        buyerWallet: getConnectedWallet(),
      });
      await loadOrders();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to cancel this escrow.");
    }
  }

  async function cancelSale(order) {
    if (!window.confirm(`Cancel ${order.escrowId}? No funds have been locked yet.`)) {
      return;
    }

    try {
      await api.post(`/escrow/${order.escrowId}/reject`, {
        sellerWallet: getConnectedWallet(),
      });
      await loadOrders();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to cancel this sale.");
    }
  }

  function continueOrder(order) {
    setEscrowData(order);

    if (isSellerRole) {
      navigate(`/seller-verification/${order.escrowId}`);
      return;
    }

    navigate(
      order.status === "Seller Accepted" ? "/deposit" : "/waiting",
      { state: { backTo: "/pending-orders" } }
    );
  }

  async function copySellerLink(order) {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/#/escrow/${order.escrowId}`
      );
      setCopiedId(order.escrowId);
      setTimeout(() => setCopiedId(""), 2000);
    } catch {
      setError("Unable to copy the seller link.");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{isSellerRole ? "Pending Sales" : "Pending Orders"}</h1>
            <p className="mt-2 text-slate-600">{isSellerRole ? "Sales waiting for the buyer to lock the selected asset." : "Escrows waiting for seller acceptance or buyer deposit."}</p>
          </div>
          <button onClick={() => navigate(isSellerRole ? "/dashboard/selling" : "/dashboard/buying")} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">← {isSellerRole ? "Selling Escrows" : "Buying Escrows"}</button>
        </div>

        {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        <div className="mt-8 space-y-5">
          {!loading && orders.length === 0 && (
            <EmptyState icon="⏳" title={isSellerRole ? "No pending sales" : "No pending orders"} message={isSellerRole ? "Accepted sales waiting for buyer payment will appear here." : "New escrow requests will appear here until funds are deposited."} />
          )}

          {orders.map((order) => (
            <article key={order.escrowId} className="rounded-2xl border border-orange-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{order.escrowId}</h2>
                  <p className="mt-2 text-slate-600">{order.productName || "Escrow transaction"}</p>
                </div>
                <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-bold text-orange-700">{order.status}</span>
              </div>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label={isSellerRole ? "Buyer" : "Seller"} value={isSellerRole ? order.buyerName : order.sellerName} />
                <Detail label="Amount" value={`${order.amount} ${order.assetSymbol || "USDC"}`} />
                <Detail label="Created" value={new Date(order.createdAt).toLocaleDateString()} />
                <CountdownDetail order={order} now={now} />
              </div>
              {isSellerRole ? (
                <div className="mt-7 grid gap-3 sm:grid-cols-2">
                  <button onClick={() => cancelSale(order)} className="rounded-xl border border-red-200 py-3 font-semibold text-red-600 hover:bg-red-50">Cancel Sale</button>
                  <button onClick={() => continueOrder(order)} className="rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700">View Sale</button>
                </div>
              ) : (
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <button onClick={() => cancelOrder(order)} className="rounded-xl border border-red-200 py-3 font-semibold text-red-600 hover:bg-red-50">Cancel Order</button>
                  <button onClick={() => copySellerLink(order)} className="rounded-xl border border-blue-200 py-3 font-semibold text-blue-600 hover:bg-blue-50">{copiedId === order.escrowId ? "Link Copied" : "Copy Seller Link"}</button>
                  <button onClick={() => continueOrder(order)} className="rounded-xl bg-blue-600 py-3 font-semibold text-white hover:bg-blue-700">{order.status === "Seller Accepted" ? `Deposit ${order.assetSymbol || "USDC"}` : "Open Order"}</button>
                </div>
              )}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-all font-semibold text-slate-900">{value || "—"}</p></div>;
}

function CountdownDetail({ order, now }) {
  const remaining = Math.max(0, getExpiryTime(order) - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const countdown = [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
      <p className="text-sm text-orange-700">Expires in</p>
      <p className="mt-1 font-mono text-lg font-bold text-orange-800">
        {remaining > 0 ? countdown : "Expired"}
      </p>
    </div>
  );
}

function getExpiryTime(order) {
  return Number(order.expiresAt) ||
    Number(order.createdAt) + PENDING_EXPIRY_MS;
}

function EmptyState({ icon, title, message }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><div className="text-4xl">{icon}</div><h2 className="mt-4 text-xl font-bold text-slate-900">{title}</h2><p className="mt-2 text-sm text-slate-600">{message}</p></div>;
}
