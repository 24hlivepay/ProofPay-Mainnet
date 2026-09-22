import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import AdminNav from "../components/AdminNav";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { useAdminGate } from "../hooks/useAdminGate";
import api from "../services/api";
import { shortenAddress } from "../utils/address";

const ACTION_LABELS = {
  "dispute.message": "Sent dispute message",
  "dispute.resolved": "Resolved dispute",
};

export default function AdminAuditLog() {
  useAdminGate();
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [escrowId, setEscrowId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .get("/admin/audit-log", { params: escrowId ? { escrowId } : {} })
      .then((response) => {
        if (active) setEntries(response.data.entries || []);
      })
      .catch((requestError) => {
        if (active) {
          if (requestError.response?.status === 401 || requestError.response?.status === 403) {
            navigate("/admin/login", { replace: true, state: { redirectTo: "/admin/audit-log" } });
            return;
          }
          setError(requestError.response?.data?.message || "Unable to load the audit log.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [escrowId, navigate]);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">Admin audit log</h1>
        <p className="mt-2 text-slate-600">
          Every dispute message and resolution sent from the admin account, with who and when.
        </p>

        <AdminNav />

        <input
          value={escrowId}
          onChange={(event) => setEscrowId(event.target.value)}
          placeholder="Filter by escrow ID"
          className="w-full max-w-xs rounded-xl border border-slate-300 px-4 py-2.5 outline-none focus:border-blue-500"
        />

        {error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

        <div className="mt-5 space-y-3">
          {loading ? (
            <p className="text-slate-500">Loading...</p>
          ) : entries.length === 0 ? (
            <p className="rounded-2xl bg-white p-6 text-slate-500">No admin actions recorded yet.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">
                    {ACTION_LABELS[entry.action] || entry.action}
                  </span>
                  <span className="text-xs text-slate-500">{formatDate(entry.at)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                  {entry.escrowId && <span>Escrow: {entry.escrowId}</span>}
                  <span>By: {shortenAddress(entry.adminWallet)}</span>
                </div>
                {entry.details && (
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                )}
              </div>
            ))
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
