import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useEscrow } from "../context/EscrowContext";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";
import {
  confirmDeliveryOnChain,
  releaseFundsOnChain,
} from "../services/proofpayContract";

export default function ActiveOrders() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setEscrowData } = useEscrow();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmingId, setConfirmingId] = useState("");
  const [releasingId, setReleasingId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const role = location.state?.role === "seller" ? "seller" : "buyer";
  const isSellerRole = role === "seller";

  const loadOrders = useCallback(async () => {
    try {
      setError("");
      const response = await api.get("/escrows", {
        params: { category: "active", wallet: getConnectedWallet(), role },
      });
      setOrders(response.data.escrows || []);
    } catch {
      setError("Unable to load active orders.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    loadOrders();

    const interval = window.setInterval(loadOrders, 4000);
    const refreshOnFocus = () => loadOrders();
    window.addEventListener("focus", refreshOnFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [loadOrders]);

  function openOrder(order) {
    setEscrowData(order);

    if (isSellerRole) {
      navigate(`/seller-verification/${order.escrowId}`);
      return;
    }

    navigate("/active", { state: { backTo: "/active-orders" } });
  }

  function openDispute(order) {
    navigate("/dispute", { state: { order } });
  }

  function respondToDispute(order) {
    navigate("/dispute/respond", { state: { order } });
  }

  async function releaseOrderFunds(order) {
    try {
      setReleasingId(order.escrowId);
      setError("");
      setActionMessage("Confirm the release transaction in your wallet.");

      const transactionHash = await releaseFundsOnChain(order.escrowId, () => {
        setActionMessage("Transaction submitted. Waiting for confirmation...");
      }, order.assetSymbol, order);

      await api.post(`/escrow/${order.escrowId}/release`, {
        transactionHash,
      });

      setActionMessage(
        `${order.escrowId}: funds released successfully. The order is now completed.`
      );
      await loadOrders();
    } catch (releaseError) {
      setActionMessage("");
      setError(releaseError.message || `Unable to release ${order.assetSymbol || "USDC"}.`);
    } finally {
      setReleasingId("");
    }
  }

  async function confirmOrderDelivery(order) {
    if (!window.confirm(`Confirm that ${order.productName || "this order"} was delivered?`)) {
      return;
    }

    try {
      setConfirmingId(order.escrowId);
      setError("");
      setActionMessage("Confirm the delivery transaction in your wallet.");

      const transactionHash = await confirmDeliveryOnChain(
        order.escrowId,
        order.assetSymbol
      );
      const response = await api.post(`/escrow/${order.escrowId}/delivered`, {
        transactionHash,
      });

      setOrders((currentOrders) =>
        currentOrders.map((currentOrder) =>
          currentOrder.escrowId === order.escrowId
            ? response.data.escrow
            : currentOrder
        )
      );
      setActionMessage(
        `${order.escrowId}: delivery confirmed. The buyer can now release the funds.`
      );
      await loadOrders();
    } catch (deliveryError) {
      setActionMessage("");
      setError(deliveryError.message || "Unable to confirm delivery.");
    } finally {
      setConfirmingId("");
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-5xl px-5 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">{isSellerRole ? "Active Sales" : "Active Purchases"}</h1>
            <p className="mt-2 text-slate-600">{isSellerRole ? "Confirm delivery after the buyer has locked the selected asset." : "Track locked funds and release payment after delivery."}</p>
          </div>
          <button onClick={() => navigate(isSellerRole ? "/dashboard/selling" : "/dashboard/buying")} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">← {isSellerRole ? "Selling Escrows" : "Buying Escrows"}</button>
        </div>

        {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
        {actionMessage && (
          <p className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 font-semibold text-green-800">
            {actionMessage}
          </p>
        )}

        <div className="mt-8 space-y-5">
          {!loading && orders.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <div className="text-4xl">📦</div>
              <h2 className="mt-5 text-2xl font-bold text-slate-900">No active {isSellerRole ? "sales" : "purchases"}</h2>
              <p className="mt-2 text-slate-600">Live escrow records will appear here after the selected asset is locked.</p>
            </div>
          )}

          {orders.map((order) => {
            const deliveryConfirmed = order.status === "Delivered";
            const disputed = order.status === "Disputed";
            const buyerMustRelease = deliveryConfirmed && !isSellerRole;
            const mySide = getConnectedWallet()?.toLowerCase() === order.buyerWallet?.toLowerCase() ? "buyer" : "seller";
            const mustRespondToDispute = disputed
              && order.dispute?.openedBySide
              && order.dispute.openedBySide !== mySide
              && !order.dispute.responses?.some((response) => response.side === mySide);

            return (
            <article
              key={order.escrowId}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${
                deliveryConfirmed ? "border-green-300" : "border-yellow-200"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">{order.escrowId}</h2>
                  <p className="mt-2 text-slate-600">{order.productName || "Escrow transaction"}</p>
                </div>
                <span className={`rounded-full px-4 py-2 text-sm font-bold ${
                  deliveryConfirmed
                    ? "bg-green-100 text-green-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}>
                  {deliveryConfirmed ? "✓ Delivery Confirmed" : order.status}
                </span>
              </div>

              {deliveryConfirmed && (
                <div className={`mt-6 rounded-2xl border p-5 ${
                  buyerMustRelease
                    ? "border-green-300 bg-green-50"
                    : "border-blue-200 bg-blue-50"
                }`}>
                  <p className={`text-lg font-bold ${
                    buyerMustRelease ? "text-green-800" : "text-blue-800"
                  }`}>
                    {buyerMustRelease
                      ? "📦 Seller confirmed delivery — release funds now"
                      : "📦 Delivery confirmed — waiting for buyer to release funds"}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {buyerMustRelease
                      ? `Open this escrow, review the delivery, and release the ${order.assetSymbol || "USDC"} payment to the seller.`
                      : "The buyer has been notified that the delivery is complete."}
                  </p>
                </div>
              )}

              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Detail label={isSellerRole ? "Buyer" : "Seller"} value={isSellerRole ? order.buyerName : order.sellerName} />
                <Detail label="Amount" value={`${order.amount} ${order.assetSymbol || "USDC"}`} />
                <Detail label="Created" value={formatDate(order.createdAt)} />
                <Detail
                  label="Next step"
                  value={
                    isSellerRole
                      ? deliveryConfirmed
                        ? "Wait for buyer to release funds"
                        : "Confirm delivery"
                      : deliveryConfirmed
                        ? "Release funds now"
                        : "Wait for delivery"
                  }
                />
              </div>
              {order.depositTransactionHash && (
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-green-200 bg-green-50 p-4">
                  <div>
                    <p className="font-bold text-green-800">✓ {order.assetSymbol || "USDC"} deposit successful</p>
                    <p className="mt-1 text-sm text-green-700">Funds are locked in the Arc Testnet escrow contract.</p>
                  </div>
                  <a href={`https://testnet.arcscan.app/tx/${order.depositTransactionHash}`} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-blue-700 shadow-sm hover:bg-blue-50">
                    View on Arcscan ↗
                  </a>
                </div>
              )}
              {disputed && (
                <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
                  <p className="font-bold">Dispute open — funds remain locked</p>
                  <p className="mt-1 text-sm">{mustRespondToDispute
                    ? "The other party opened a dispute. Submit your response and evidence so ProofPay admin can review both sides."
                    : "Only ProofPay admin can now resolve this escrow through the smart contract."}</p>
                  <button onClick={() => respondToDispute(order)} className="mt-4 w-full rounded-xl bg-red-600 py-3 font-semibold text-white hover:bg-red-700">
                    {mustRespondToDispute ? "Respond to dispute" : "View dispute"}
                  </button>
                </div>
              )}
              {!disputed && (!isSellerRole || !deliveryConfirmed) && (
                <button
                  onClick={() => isSellerRole
                    ? confirmOrderDelivery(order)
                    : buyerMustRelease
                      ? releaseOrderFunds(order)
                      : openOrder(order)
                  }
                  disabled={
                    confirmingId === order.escrowId ||
                    releasingId === order.escrowId
                  }
                  className={`mt-7 w-full rounded-xl py-3 font-semibold text-white ${
                    buyerMustRelease
                      ? "bg-green-600 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-green-300"
                      : "bg-blue-600 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  }`}
                >
                  {confirmingId === order.escrowId
                    ? "Confirming Delivery..."
                    : releasingId === order.escrowId
                      ? "Releasing Funds..."
                      : isSellerRole
                        ? "Confirm Delivery"
                        : buyerMustRelease
                          ? "Release Funds Now"
                          : "Open Escrow"}
                </button>
              )}
              {!disputed && <button
                onClick={() => openDispute(order)}
                disabled={confirmingId === order.escrowId || releasingId === order.escrowId}
                className="mt-3 w-full rounded-xl border border-red-200 bg-red-50 py-3 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                Open Dispute
              </button>}
            </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Detail({ label, value }) {
  return <div className="rounded-xl border border-slate-200 p-4"><p className="text-sm text-slate-500">{label}</p><p className="mt-1 break-all font-semibold text-slate-900">{value || "—"}</p></div>;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";

  return new Date(timestamp).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
