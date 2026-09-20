import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { useEscrow } from "../context/EscrowContext";
import api from "../services/api";
import { releaseFundsOnChain } from "../services/proofpayContract";
import { getExplorerTxUrl, getNetworkConfig } from "../config/network";
import CopyButton from "../components/CopyButton";
import { shortenAddress } from "../utils/address";

export default function EscrowActive() {
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const location = useLocation();
  const { escrowData, setEscrowData } = useEscrow();
  const [submitting, setSubmitting] = useState(false);
  const [releaseStage, setReleaseStage] = useState("");
  const [error, setError] = useState("");
  const walletLabel =
    localStorage.getItem("proofpay-wallet-type") === "circle"
      ? "Circle"
      : "MetaMask";
  const backTo = location.state?.backTo || "/dashboard/buying";
  const backLabel = backTo === "/active-orders"
    ? "Back to Active Orders"
    : backTo === "/dashboard/buying"
      ? "Back to Buying Escrows"
    : "Back to Buying Escrows";

  useEffect(() => {
    if (!escrowData.escrowId) return undefined;

    const interval = setInterval(async () => {
      try {
        const response = await api.get(`/escrow/${escrowData.escrowId}/status`);
        setEscrowData(response.data.escrow);
      } catch {
        // The next poll will try again.
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [escrowData.escrowId, setEscrowData]);

  async function handleReleaseFunds() {
    try {
      setSubmitting(true);
      setError("");
      setReleaseStage("confirm-wallet");
      const transactionHash = await releaseFundsOnChain(escrowData.escrowId, () => {
        setReleaseStage("processing");
      }, escrowData.assetSymbol, escrowData);
      const response = await api.post(`/escrow/${escrowData.escrowId}/release`, {
        transactionHash,
      });
      setEscrowData({ ...response.data.escrow, transactionHash });
      setReleaseStage("success");
    } catch (releaseError) {
      setReleaseStage("");
      setError(releaseError.message || `Unable to release ${escrowData.assetSymbol || "USDC"}.`);
    } finally {
      setSubmitting(false);
    }
  }

  const delivered = escrowData.status === "Delivered";

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h1 className="text-3xl font-bold">Escrow Active</h1><p className="mt-2 text-slate-600">Manage the live {getNetworkConfig().chainName} {escrowData.assetSymbol || "USDC"} escrow.</p></div>
            <span className={`rounded-full px-5 py-2 font-semibold ${delivered ? "bg-blue-100 text-blue-700" : "bg-yellow-100 text-yellow-700"}`}>{delivered ? "Delivered" : `${escrowData.assetSymbol || "USDC"} Locked`}</span>
          </div>

          <div className="mt-7 rounded-xl border border-slate-200 p-5 sm:p-6">
            <div className="space-y-4">
              <SummaryRow label="Buyer" value={escrowData.buyerName} />
              <SummaryRow label="Buyer email" value={escrowData.buyerEmail} />
              <SummaryRow label="Buyer wallet" value={shortenAddress(escrowData.buyerWallet)} copyValue={escrowData.buyerWallet} copyable />
              <SummaryRow label="Seller" value={escrowData.sellerName} />
              <SummaryRow label="Seller email" value={escrowData.sellerEmail} />
              <SummaryRow label="Seller wallet" value={shortenAddress(escrowData.sellerWallet)} copyValue={escrowData.sellerWallet} copyable />
              <SummaryRow label="Product / Service" value={escrowData.productName} />
              <SummaryRow label="Amount" value={`${escrowData.amount} ${escrowData.assetSymbol || "USDC"}`} />
              <SummaryRow label="Escrow ID" value={escrowData.escrowId} />
              {escrowData.transactionHash && <SummaryRow label="Latest transaction" value={escrowData.transactionHash} />}
            </div>
          </div>

          <h2 className={`mt-8 text-2xl font-bold ${delivered ? "text-blue-700" : "text-yellow-700"}`}>{delivered ? "Seller Confirmed Delivery" : "Funds Locked"}</h2>

          {escrowData.depositTransactionHash && (
            <TransactionProof hash={escrowData.depositTransactionHash} assetSymbol={escrowData.assetSymbol} />
          )}

          {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

          <div className="mt-10">
            <button onClick={handleReleaseFunds} disabled={!delivered || submitting} className="w-full rounded-xl bg-green-600 py-4 font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300">
              {submitting ? `Releasing ${escrowData.assetSymbol || "USDC"}...` : delivered ? "Release Funds" : "Waiting for Delivery"}
            </button>
            <button onClick={() => navigate(backTo)} className="mt-4 w-full rounded-xl bg-blue-600 py-4 font-semibold text-white transition hover:bg-blue-700">
              {backLabel}
            </button>
          </div>
        </div>
      </main>

      {releaseStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            {releaseStage === "confirm-wallet" && (
              <>
                <div className="text-4xl">🔐</div>
                <h2 className="mt-4 text-2xl font-bold text-slate-900">Confirm in {walletLabel}</h2>
                <p className="mt-3 text-slate-600">Review and confirm the release transaction in your wallet. No funds have moved yet.</p>
              </>
            )}

            {releaseStage === "processing" && (
              <>
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
                <h2 className="mt-5 text-2xl font-bold text-slate-900">Release in progress</h2>
                <p className="mt-3 text-slate-600">Your transaction is being confirmed on {getNetworkConfig().chainName}. Please keep this page open.</p>
              </>
            )}

            {releaseStage === "success" && (
              <>
                <div className="text-5xl">✅</div>
                <h2 className="mt-4 text-2xl font-bold text-slate-900">Funds released</h2>
                <p className="mt-3 text-slate-600">The {escrowData.assetSymbol || "USDC"} payment has been transferred to the seller's wallet.</p>
                <button
                  onClick={() => navigate("/dashboard/buying")}
                  className="mt-7 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700"
                >
                  Go to Dashboard
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, copyValue, copyable = false }) {
  return (
    <div className="flex gap-6 justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="flex items-center gap-2 text-right">
        <strong className="break-all">{value || "—"}</strong>
        {copyable && copyValue && <CopyButton value={copyValue} />}
      </span>
    </div>
  );
}

function TransactionProof({ hash, assetSymbol = "USDC" }) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-green-200 bg-green-50 p-5">
      <div>
        <p className="font-bold text-green-800">✓ Deposit confirmed on {getNetworkConfig().chainName}</p>
        <p className="mt-1 text-sm text-green-700">The buyer's {assetSymbol} lock transaction is recorded on-chain.</p>
      </div>
      <a href={getExplorerTxUrl(hash)} target="_blank" rel="noreferrer" className="rounded-xl bg-white px-4 py-2 font-bold text-blue-700 shadow-sm hover:bg-blue-50">
        View on Arcscan ↗
      </a>
    </div>
  );
}
