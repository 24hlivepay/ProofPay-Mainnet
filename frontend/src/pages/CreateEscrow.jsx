import { useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import InputField from "../components/InputField";
import PrimaryButton from "../components/PrimaryButton";
import { useEscrow } from "../context/EscrowContext";
import api from "../services/api";
import {
  connectWallet,
  getCircleAuthSession,
  getWalletSession,
} from "../services/wallet";
import { ESCROW_ASSETS, getEscrowAsset } from "../config/escrowAssets";

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

function formatAssetBalance(value, decimals) {
  const numericValue = Number(value || 0);

  if (!Number.isFinite(numericValue)) return "0";

  return numericValue.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
}

function truncateAssetAmount(value, decimals) {
  const [whole = "0", fraction = ""] = String(value).split(".");
  const trimmedFraction = fraction.slice(0, decimals).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export default function CreateEscrow() {
  const navigate = useNavigate();
  const { setEscrowData } = useEscrow();
  const [buyerName, setBuyerName] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [productName, setProductName] = useState("");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("USDC");
  const [assetBalance, setAssetBalance] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectedAsset = getEscrowAsset(assetSymbol);

  async function loadSelectedBalance(asset = selectedAsset) {
    try {
      setBalanceLoading(true);
      setError("");
      const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
      let balance;

      if (walletType === "circle") {
        const session = getWalletSession();
        const auth = getCircleAuthSession();

        if (!session?.walletId || !auth?.userToken) {
          throw new Error("Your Circle wallet session has expired. Sign in again.");
        }

        const response = await api.get(`/circle/wallets/${session.walletId}/balances`, {
          headers: { "X-User-Token": auth.userToken },
        });
        const matches = (response.data.data?.tokenBalances || []).filter(
          (item) => item?.token?.symbol === asset.symbol
        );
        balance = matches.reduce(
          (largest, item) => Number(item.amount || 0) > Number(largest) ? item.amount : largest,
          "0"
        );
      } else {
        const { address, provider } = await connectWallet();

        if (asset.isNative) {
          balance = formatUnits(await provider.getBalance(address), 18);
        } else {
          const token = new Contract(
            asset.tokenAddress,
            BALANCE_ABI,
            provider
          );
          balance = formatUnits(
            await token.balanceOf(address),
            asset.decimals
          );
        }
      }

      setAssetBalance(String(balance || "0"));
      return String(balance || "0");
    } catch (balanceError) {
      setError(balanceError.message || `Unable to load ${asset.symbol} balance.`);
      return null;
    } finally {
      setBalanceLoading(false);
    }
  }

  async function useMaximumAmount() {
    const currentBalance = assetBalance || await loadSelectedBalance();
    if (currentBalance === null) return;

    let maximum = currentBalance;
    if (selectedAsset.symbol === "USDC") {
      const units = parseUnits(currentBalance, 18);
      const reserve = parseUnits("0.01", 18);
      maximum = formatUnits(units > reserve ? units - reserve : 0n, 18);
    }

    setAmount(truncateAssetAmount(maximum, selectedAsset.decimals));
  }

  async function handleCreateEscrow() {
    if (!buyerName || !sellerName || !productName || !amount) {
      setError("Please complete all required fields.");
      return;
    }

    const amountPattern = new RegExp(`^\\d+(\\.\\d{1,${selectedAsset.decimals}})?$`);

    if (!amountPattern.test(amount.trim()) || Number(amount) <= 0) {
      setError(`Enter a valid ${selectedAsset.symbol} amount.`);
      return;
    }

    if (!selectedAsset.escrowAddress) {
      setError(`${selectedAsset.symbol} escrow deployment is not configured yet.`);
      return;
    }

    if (assetBalance && Number(amount) > Number(assetBalance)) {
      setError(`Your ${selectedAsset.symbol} balance is too low.`);
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      const { address: buyerWallet } = await connectWallet();
      const response = await api.post("/escrow", {
        buyerName,
        buyerWallet,
        sellerName,
        productName,
        productId,
        amount,
        assetSymbol: selectedAsset.symbol,
        assetDecimals: selectedAsset.decimals,
        tokenAddress: selectedAsset.tokenAddress,
        escrowContractAddress: selectedAsset.escrowAddress,
        description,
      });

      setEscrowData(response.data.escrow);
      navigate("/waiting");
    } catch (requestError) {
      setError(requestError.message || "Unable to create escrow.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-2xl px-5 py-7 sm:px-6">
        <button onClick={() => navigate("/dashboard/buying")} className="mb-5 text-sm font-semibold text-blue-600">
          ← Back to Buying Escrows
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-bold text-slate-900">Create New Escrow</h1>
          <p className="mt-2 text-sm text-slate-600">
            Create the deal and send its secure link to the seller. Their wallet will bind automatically when they accept.
          </p>

          <div className="mt-5 rounded-xl border p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-bold">Buyer Information</h2>
            <div className="space-y-3">
              <InputField placeholder="Buyer Name" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} />
              <InputField placeholder="Product / Service Name" value={productName} onChange={(event) => setProductName(event.target.value)} />
              <InputField placeholder="Product ID (Optional)" value={productId} onChange={(event) => setProductId(event.target.value)} />
              <div className="overflow-hidden rounded-xl border border-slate-300 bg-white transition focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100">
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3 text-sm">
                  <label htmlFor="escrow-asset" className="font-semibold text-slate-700">
                    Payment asset
                  </label>
                  <div className="ml-auto flex items-center gap-2">
                    <span className="text-slate-500">
                      {balanceLoading
                        ? "Loading…"
                        : `${formatAssetBalance(assetBalance, selectedAsset.decimals)} ${selectedAsset.symbol}`}
                    </span>
                    <button
                      type="button"
                      onClick={useMaximumAmount}
                      disabled={balanceLoading}
                      className="rounded-lg bg-blue-50 px-3 py-1 font-bold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-4 pb-3">
                  <select
                    id="escrow-asset"
                    value={assetSymbol}
                    onChange={(event) => {
                      const nextAsset = getEscrowAsset(event.target.value);
                      setAssetSymbol(nextAsset.symbol);
                      setAmount("");
                      setAssetBalance("");
                      loadSelectedBalance(nextAsset);
                    }}
                    className="min-w-0 flex-1 appearance-auto bg-white py-2 text-lg font-bold outline-none"
                  >
                    {ESCROW_ASSETS.map((asset) => (
                      <option key={asset.symbol} value={asset.symbol}>
                        {asset.symbol}
                      </option>
                    ))}
                  </select>
                  <input
                    inputMode="decimal"
                    aria-label={`Amount in ${selectedAsset.symbol}`}
                    placeholder="0.00"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="w-32 border-l border-slate-200 py-2 pl-4 text-right text-lg font-bold outline-none placeholder:text-slate-400 sm:w-44"
                  />
                </div>
              </div>
              <textarea rows={3} placeholder="Deal Description (Optional)" value={description} onChange={(event) => setDescription(event.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500" />
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>12-hour secure link</strong>
                <p className="mt-1 text-amber-800">This escrow request expires automatically in 12 hours if funds are not locked.</p>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-xl border p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-bold">Seller Information</h2>
            <InputField placeholder="Business / Seller Name" value={sellerName} onChange={(event) => setSellerName(event.target.value)} />
          </div>

          {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

          <div className="mt-6">
            <PrimaryButton onClick={handleCreateEscrow} disabled={submitting}>
              {submitting ? "Creating Escrow..." : "Generate Secure Escrow Link"}
            </PrimaryButton>
          </div>
        </div>
      </main>
    </div>
  );
}
