import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import PrimaryButton from "../components/PrimaryButton";
import { useEscrow } from "../context/EscrowContext";
import DealDocuments from "../components/DealDocuments";
import api from "../services/api";
import { confirmDeliveryOnChain } from "../services/proofpayContract";
import { getExplorerTxUrl, getNetworkConfig } from "../config/network";
import CopyButton from "../components/CopyButton";
import { shortenAddress } from "../utils/address";

export default function SellerVerification() {
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const { id } = useParams();
  const { escrowData, setEscrowData } = useEscrow();
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    async function loadEscrow() {
      try {
        const response = await api.get(`/escrow/${id}`);
        if (active) {
          setEscrowData(response.data.escrow);
          setError("");
        }
      } catch {
        if (active) {
          setError("Unable to load this escrow. Please refresh the page.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEscrow();
    const interval = setInterval(loadEscrow, 4000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [id, setEscrowData]);

  async function copyVerificationCode() {
    await navigator.clipboard.writeText(escrowData.verificationCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function completeDelivery() {
    if (!window.confirm("Confirm that the product or service was delivered?")) return;

    try {
      setSubmitting(true);
      setError("");
      const transactionHash = await confirmDeliveryOnChain(
        escrowData.escrowId,
        escrowData.assetSymbol
      );
      const response = await api.post(`/escrow/${escrowData.escrowId}/delivered`, {
        transactionHash,
      });
      setEscrowData({ ...response.data.escrow, transactionHash });
    } catch (deliveryError) {
      setError(deliveryError.message || "Unable to confirm delivery.");
    } finally {
      setSubmitting(false);
    }
  }

  const content = loading ? (
    <StatusCard title="Loading escrow..." message="Please wait while ProofPay loads the seller verification." />
  ) : error ? (
    <StatusCard title="Verification unavailable" message={error} error />
  ) : escrowData.status === "Seller Accepted" ? (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="text-center">
        <div className="text-4xl">🤝</div>
        <h1 className="mt-4 text-3xl font-bold text-green-700">Deal Accepted</h1>
        <p className="mt-4 text-slate-600">Share this code with the buyer so they can fund the live {escrowData.assetSymbol || "USDC"} escrow.</p>
      </div>
      <div className="mt-7 rounded-xl border border-blue-200 bg-blue-50 p-5 text-center sm:p-6">
        <p className="text-sm text-slate-500">Verification Code</p>
        <div className="mt-4 flex items-center justify-center gap-4">
          <strong className="text-4xl tracking-widest text-blue-700">{escrowData.verificationCode}</strong>
          <button onClick={copyVerificationCode} className="rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-sm font-medium text-blue-700">{copied ? "Copied" : "Copy"}</button>
        </div>
      </div>
    </div>
  ) : escrowData.status === "Funds Locked" ? (
    <div className="rounded-2xl border border-green-200 bg-white p-6 text-center shadow-lg sm:p-8">
      <div className="text-5xl">🔒</div>
      <h1 className="mt-4 text-3xl font-bold text-green-700">{escrowData.assetSymbol || "USDC"} Locked</h1>
      <p className="mt-5 text-lg text-slate-600">The buyer’s {escrowData.assetSymbol || "USDC"} is locked in the {getNetworkConfig().chainName} escrow contract.</p>
      {escrowData.depositTransactionHash && <TransactionProof hash={escrowData.depositTransactionHash} assetSymbol={escrowData.assetSymbol} />}
      <div className="mt-10"><PrimaryButton onClick={completeDelivery} disabled={submitting}>{submitting ? "Confirming Delivery..." : "Delivery Completed"}</PrimaryButton></div>
    </div>
  ) : escrowData.status === "Delivered" ? (
    <StatusCard title="Delivery Confirmed" message={`The buyer can now release the ${escrowData.assetSymbol || "USDC"} from the smart contract.`} />
  ) : escrowData.status === "Released" ? (
    <StatusCard title="Payment Received" message={`The buyer released the ${escrowData.assetSymbol || "USDC"}. Payment has been sent to your seller wallet.`} />
  ) : (
    <StatusCard title="Escrow status updated" message={`Current status: ${escrowData.status || "Unknown"}`} />
  );

  const sellerBack = getSellerBackDestination(escrowData.status);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <button onClick={() => navigate(sellerBack.path, { state: sellerBack.state })} className="mb-8 font-semibold text-blue-600 hover:text-blue-700">
          ← {sellerBack.label}
        </button>

        {escrowData.escrowId && (
          <div className="mb-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-lg font-bold">Escrow Summary</h2>
            <div className="space-y-3">
              <SummaryRow label="Buyer" value={escrowData.buyerName} />
              <SummaryRow label="Buyer email" value={escrowData.buyerEmail} />
              <SummaryRow label="Buyer wallet" value={shortenAddress(escrowData.buyerWallet)} copyValue={escrowData.buyerWallet} copyable />
              <SummaryRow label="Seller" value={escrowData.sellerName} />
              <SummaryRow label="Seller email" value={escrowData.sellerEmail} />
              <SummaryRow label="Seller wallet" value={shortenAddress(escrowData.sellerWallet)} copyValue={escrowData.sellerWallet} copyable />
              <SummaryRow label="Product / Service" value={escrowData.productName} />
              <SummaryRow label="Amount" value={`${escrowData.amount} ${escrowData.assetSymbol || "USDC"}`} />
              <SummaryRow label="Escrow ID" value={escrowData.escrowId} />
            </div>
          </div>
        )}

        {escrowData.escrowId && <div className="mb-7"><DealDocuments escrowId={escrowData.escrowId} /></div>}

        {content}
      </main>
    </div>
  );
}

function getSellerBackDestination(status) {
  if (status === "Seller Accepted") {
    return { path: "/pending-orders", state: { role: "seller" }, label: "Back to Pending Sales" };
  }

  if (status === "Funds Locked" || status === "Delivered") {
    return { path: "/active-orders", state: { role: "seller" }, label: "Back to Active Sales" };
  }

  if (status === "Released") {
    return { path: "/completed-orders", state: { role: "seller" }, label: "Back to Payments Received" };
  }

  if (status === "Cancelled") {
    return { path: "/cancelled-orders", state: { role: "seller" }, label: "Back to Cancelled Sales" };
  }

  return { path: "/dashboard/selling", state: undefined, label: "Back to Selling Escrows" };
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

function StatusCard({ title, message, error = false }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
      <h1 className={`text-3xl font-bold ${error ? "text-red-700" : "text-blue-700"}`}>{title}</h1>
      <p className="mt-4 text-slate-600">{message}</p>
    </div>
  );
}

function TransactionProof({ hash, assetSymbol = "USDC" }) {
  return (
    <div className="mx-auto mt-7 max-w-xl rounded-2xl border border-green-200 bg-green-50 p-5 text-left">
      <p className="font-bold text-green-800">✓ Buyer deposit confirmed on {getNetworkConfig().chainName}</p>
      <p className="mt-1 text-sm text-green-700">Open the explorer to verify the locked {assetSymbol} before confirming delivery.</p>
      <a href={getExplorerTxUrl(hash)} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 font-bold text-blue-700 shadow-sm hover:bg-blue-50">
        View deposit on Arcscan ↗
      </a>
    </div>
  );
}
