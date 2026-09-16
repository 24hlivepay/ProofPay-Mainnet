import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import InputField from "../components/InputField";
import PrimaryButton from "../components/PrimaryButton";
import api from "../services/api";
import { useEscrow } from "../context/EscrowContext";
import { fundEscrow } from "../services/proofpayContract";
import { connectWallet } from "../services/wallet";

export default function BuyerDeposit() {
  const navigate = useNavigate();
  const location = useLocation();
  const { escrowData, setEscrowData, updateEscrow } = useEscrow();
  const [code, setCode] = useState("");
  const verified = Boolean(escrowData.sellerVerified);
  const [verifying, setVerifying] = useState(false);
  const [loadingEscrow, setLoadingEscrow] = useState(
    Boolean(escrowData.escrowId)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const networkCheckDelayed = error.startsWith(
    "Your payment has not started and no funds were deducted."
  );
  const walletLabel =
    localStorage.getItem("proofpay-wallet-type") === "circle"
      ? "Circle wallet"
      : "MetaMask";
  const backTo = location.state?.backTo || "/dashboard/buying";
  const backLabel = backTo === "/pending-orders"
    ? "← Back to Pending Orders"
    : backTo === "/active-orders"
      ? "← Back to Active Orders"
      : "← Back to Buying Escrows";

  useEffect(() => {
    let active = true;
    const escrowId = escrowData.escrowId;

    if (!escrowId) {
      return () => {
        active = false;
      };
    }

    api.get(`/escrow/${escrowId}`)
      .then((response) => {
        if (!active) return;

        setEscrowData(response.data.escrow);
        setError("");
      })
      .catch(() => {
        if (active) {
          setError("Unable to refresh this escrow. Please try again.");
        }
      })
      .finally(() => {
        if (active) {
          setLoadingEscrow(false);
        }
      });

    return () => {
      active = false;
    };
  }, [escrowData.escrowId, setEscrowData]);

  async function verifyCode() {
    try {
      setVerifying(true);
      setError("");

      const response = await api.post(
        `/escrow/${escrowData.escrowId}/verify-seller`,
        { verificationCode: code.trim() }
      );
      const updatedEscrow = response.data.escrow;

      setEscrowData(updatedEscrow);
      updateEscrow(updatedEscrow);
    } catch (verificationError) {
      setError(
        verificationError.response?.data?.message ||
        "Seller verification failed. Please try again."
      );
    } finally {
      setVerifying(false);
    }
  }

  async function handleDeposit() {
    try {
      setSubmitting(true);
      setError("");

      const numericAmount = String(escrowData.amount || "").trim();

      if (!/^\d+(\.\d{1,6})?$/.test(numericAmount) || Number(numericAmount) <= 0) {
        throw new Error("This escrow has an invalid USDC amount. Create it again with a number such as 27.");
      }

      const { address: connectedAddress } = await connectWallet();
      const expectedBuyerWallet = escrowData.buyerWallet?.toLowerCase();

      if (expectedBuyerWallet && connectedAddress.toLowerCase() !== expectedBuyerWallet) {
        throw new Error(
          `Connect the buyer ${walletLabel} (${expectedBuyerWallet.slice(0, 6)}...${expectedBuyerWallet.slice(-4)}) before depositing.`
        );
      }

      const { hash } = await fundEscrow({
        escrowId: escrowData.escrowId,
        sellerAddress: escrowData.sellerWallet,
        amount: escrowData.amount,
        assetSymbol: escrowData.assetSymbol,
      });

      const response = await api.post(`/escrow/${escrowData.escrowId}/deposit`, {
        transactionHash: hash,
      });
      const updatedEscrow = {
        ...escrowData,
        ...response.data.escrow,
        transactionHash: hash,
        status: "Funds Locked",
      };

      setEscrowData(updatedEscrow);
      updateEscrow(updatedEscrow);
      navigate("/active", { state: { backTo: "/dashboard/buying" } });
    } catch (transactionError) {
      setError(transactionError.message || "USDC deposit failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <button onClick={() => navigate(backTo)} className="mb-8 font-semibold text-blue-600 hover:text-blue-700">
          {backLabel}
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-3xl font-bold text-slate-900">Verify & Deposit</h1>
          <p className="mt-3 text-slate-600">
            Confirm the seller’s code, then approve and lock {escrowData.assetSymbol || "USDC"} through your {walletLabel}.
          </p>

          <div className="mt-7 rounded-xl border border-slate-200 p-5 sm:p-6">
            <h2 className="mb-6 text-2xl font-bold">Escrow Summary</h2>
            <div className="space-y-4">
              <SummaryRow label="Buyer" value={escrowData.buyerName} />
              <SummaryRow label="Buyer wallet" value={escrowData.buyerWallet} />
              <SummaryRow label="Seller" value={escrowData.sellerName} />
              <SummaryRow label="Seller wallet" value={escrowData.sellerWallet} />
              <SummaryRow label="Product / Service" value={escrowData.productName} />
              <SummaryRow label="Amount" value={`${escrowData.amount} ${escrowData.assetSymbol || "USDC"}`} />
              <SummaryRow label="Escrow ID" value={escrowData.escrowId} />
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5 sm:p-6">
            <h2 className="text-2xl font-bold text-blue-700">Seller Verification</h2>
            <p className="mt-3 text-slate-700">Enter the code supplied by the seller.</p>
            <div className="mt-6">
              <InputField
                placeholder="Enter 6-digit verification code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={verified || verifying || loadingEscrow}
              />
              <button
                onClick={verifyCode}
                disabled={verified || verifying || loadingEscrow || !code.trim()}
                className={`mt-6 w-full rounded-xl border py-4 font-semibold transition ${
                  verified
                    ? "cursor-not-allowed border-green-300 bg-green-100 text-green-700"
                    : "border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white"
                }`}
              >
                {verified
                  ? "✓ Seller Verified"
                  : loadingEscrow
                    ? "Checking Verification..."
                    : verifying
                      ? "Verifying Seller..."
                      : "Verify Seller"}
              </button>
            </div>
          </div>

          {verified && <div className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-green-700">Seller verified. You can now lock the {escrowData.assetSymbol || "USDC"} in the live ARC Testnet contract.</div>}
          {error && (
            <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-800">
              <p className="font-bold">
                {networkCheckDelayed
                  ? "Arc network is temporarily busy"
                  : "Payment not completed"}
              </p>
              <p className="mt-1 leading-6">{error}</p>
            </div>
          )}

          <div className="mt-10">
            <PrimaryButton onClick={handleDeposit} disabled={!verified || submitting || loadingEscrow}>
              {submitting
                ? `Confirming ${escrowData.assetSymbol || "USDC"} Deposit...`
                : networkCheckDelayed
                  ? "Try Deposit Again"
                  : `Deposit ${escrowData.amount} ${escrowData.assetSymbol || "USDC"}`}
            </PrimaryButton>
          </div>
        </div>
      </main>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex gap-6 justify-between">
      <span className="text-slate-500">{label}</span>
      <strong className="break-all text-right">{value || "—"}</strong>
    </div>
  );
}
