import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import AdminNav from "../components/AdminNav";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { useAdminGate } from "../hooks/useAdminGate";
import api from "../services/api";
import { shortenAddress } from "../utils/address";

const STATUS = {
  opened: { label: "Opened the widget", className: "bg-slate-100 text-slate-700" },
  not_completed: { label: "Not completed", className: "bg-amber-50 text-amber-800" },
  submitted: { label: "Payment submitted", className: "bg-blue-50 text-blue-800" },
  settled: { label: "Settled", className: "bg-green-50 text-green-800" },
};

export default function AdminOnramp() {
  useAdminGate();
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .get("/admin/onramp")
      .then((response) => {
        if (active) setPurchases(response.data.purchases || []);
      })
      .catch((requestError) => {
        if (active) {
          if (requestError.response?.status === 401 || requestError.response?.status === 403) {
            navigate("/admin/login", { replace: true, state: { redirectTo: "/admin/onramp" } });
            return;
          }
          setError(requestError.response?.data?.message || "Unable to load onramp records.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <h1 className="text-3xl font-bold text-slate-900">Onramp records</h1>
        <p className="mt-2 text-slate-600">
          Who opened the Buy USDC / EURC widget on this network and how far each purchase got, as
          reported by the user's browser. A user who closes the page after paying stays at
          "Payment submitted" even though the purchase settles.
        </p>

        <button onClick={() => navigate("/dashboard")} className="mt-5 font-semibold text-blue-600 hover:text-blue-700">
          ← Back
        </button>

        <AdminNav />

        {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-slate-500">Loading...</p>
          ) : purchases.length === 0 ? (
            !error && <p className="rounded-2xl bg-white p-6 text-slate-500">No onramp activity recorded yet.</p>
          ) : (
            purchases.map((purchase) => {
              const status = STATUS[purchase.status] || STATUS.opened;
              return (
                <div key={`${purchase.wallet}:${purchase.clientId}`} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                    <span className="text-xs text-slate-500">{formatDate(purchase.updatedAt)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                    <span title={purchase.wallet}>Wallet: {shortenAddress(purchase.wallet)}</span>
                    {purchase.amount && <span>Amount: {purchase.amount}</span>}
                    {purchase.tokenSymbol && <span>Token: {purchase.tokenSymbol}</span>}
                    {purchase.paymentMethod && <span>Paid by: {purchase.paymentMethod}</span>}
                    {purchase.code && purchase.status === "not_completed" && <span>Reason: {purchase.code}</span>}
                  </div>
                  {(purchase.orderId || purchase.transactionHash) && (
                    <div className="mt-1 break-all text-xs text-slate-500">
                      {purchase.orderId && <div>Order: {purchase.orderId}</div>}
                      {purchase.transactionHash && <div>Transaction: {purchase.transactionHash}</div>}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
    </div>
  );
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}
