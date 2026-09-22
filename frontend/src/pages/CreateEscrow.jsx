import { useEffect, useState } from "react";
import { Contract, formatUnits, parseUnits } from "ethers";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import InputField from "../components/InputField";
import PrimaryButton from "../components/PrimaryButton";
import CopyButton from "../components/CopyButton";
import { useEscrow } from "../context/EscrowContext";
import api from "../services/api";
import {
  connectWallet,
  getCircleAuthSession,
  getWalletSession,
} from "../services/wallet";
import { getEscrowAsset, getEscrowAssets } from "../config/escrowAssets";
import { getProfileEmail, getProfileName } from "../utils/profile";
import { shortenAddress } from "../utils/address";

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
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const { setEscrowData } = useEscrow();
  const [buyerName, setBuyerName] = useState(() => getProfileName(walletAddress));
  const [buyerEmail, setBuyerEmail] = useState(() => getProfileEmail(walletAddress));

  useEffect(() => {
    setBuyerName(getProfileName(walletAddress));
    setBuyerEmail(getProfileEmail(walletAddress));
  }, [walletAddress]);
  const [productName, setProductName] = useState("");
  const [productId, setProductId] = useState("");
  const [amount, setAmount] = useState("");
  const [assetSymbol, setAssetSymbol] = useState("USDC");
  const [assetBalance, setAssetBalance] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [description, setDescription] = useState("");
  const [expectedSeller, setExpectedSeller] = useState("");
  const [sellerSeen, setSellerSeen] = useState(null); // null | true | false
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

  const isValidSellerAddress = (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr.trim());

  async function checkSellerSeen(addr) {
    if (!isValidSellerAddress(addr)) return;
    try {
      const response = await api.get(`/wallet/seen?address=${encodeURIComponent(addr.trim().toLowerCase())}`);
      setSellerSeen(response.data?.seen ?? null);
    } catch {
      setSellerSeen(null);
    }
  }

  async function handleCreateEscrow() {
    if (!buyerName || !productName || !amount) {
      setError("Please complete all required fields.");
      return;
    }

    if (!expectedSeller.trim()) {
      setError("Seller wallet address is required.");
      return;
    }

    if (!isValidSellerAddress(expectedSeller)) {
      setError("Enter a valid wallet address starting with 0x.");
      return;
    }

    if (expectedSeller.trim().toLowerCase() === walletAddress?.toLowerCase()) {
      setError("The seller cannot be yourself.");
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
        buyerEmail,
        productName,
        productId,
        amount,
        assetSymbol: selectedAsset.symbol,
        assetDecimals: selectedAsset.decimals,
        tokenAddress: selectedAsset.tokenAddress,
        escrowContractAddress: selectedAsset.escrowAddress,
        description,
        expectedSeller: expectedSeller.trim().toLowerCase(),
      });

      setEscrowData(response.data.escrow);
      navigate("/waiting");
    } catch (requestError) {
      setError(requestError.message || "Unable to create escrow.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!buyerName) {
    return (
      <div className="min-h-screen bg-slate-100">
        <Navbar walletSlot={walletSlot} />
        <main className="mx-auto max-w-lg px-5 py-10 text-center sm:px-6">
          <div className="rounded-2xl border border-amber-200 bg-white p-7 shadow-sm">
            <div className="text-4xl">👤</div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Complete your profile first</h1>
            <p className="mt-3 text-slate-600">
              {walletAddress
                ? "Add your name to your ProofPay profile before creating an escrow. It's used as your Buyer Name on every deal from here on."
                : "Connect your wallet and add your name to your ProofPay profile before creating an escrow."}
            </p>
            <button
              onClick={() => navigate("/profile")}
              className="mt-7 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
            >
              Go to Profile
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-2xl px-5 py-7 sm:px-6">
        <button onClick={() => navigate("/dashboard/buying")} className="mb-5 text-sm font-semibold text-blue-600">
          ← Back to Buying Escrows
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h1 className="text-2xl font-bold text-slate-900">Create New Escrow</h1>
          <p className="mt-2 text-sm text-slate-600">
            Enter your seller&apos;s ProofPay wallet address. They must sign in to ProofPay first (any wallet type) to have one — ask them to check their Profile page and copy it from there.
          </p>

          <div className="mt-5 rounded-xl border p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">Buyer Information</h2>
              <button type="button" onClick={() => navigate("/profile")} className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                Edit in Profile
              </button>
            </div>
            <div className="space-y-2">
              <InfoRow label="Name" value={buyerName} />
              <InfoRow label="Email" value={buyerEmail} />
              <InfoRow label="Wallet" value={shortenAddress(walletAddress)} copyValue={walletAddress} copyable />
            </div>
          </div>

          <div className="mt-4 rounded-xl border p-4 sm:p-5">
            <h2 className="mb-4 text-lg font-bold">Product Information</h2>
            <div className="space-y-3">
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
                    {getEscrowAssets().map((asset) => (
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

              {/* PR-3: required seller wallet lock */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <label className="mb-1 block text-sm font-semibold text-slate-700">
                  Seller Wallet Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={expectedSeller}
                  onChange={(e) => {
                    setExpectedSeller(e.target.value);
                    setSellerSeen(null);
                  }}
                  onBlur={() => checkSellerSeen(expectedSeller)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 font-mono text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Only this wallet can accept the deal. Ask your seller to copy their address from their ProofPay Profile page.
                </p>
                {expectedSeller && !isValidSellerAddress(expectedSeller) && (
                  <p className="mt-1.5 text-xs text-red-600">Enter a valid wallet address starting with 0x.</p>
                )}
                {expectedSeller.trim().toLowerCase() === walletAddress?.toLowerCase() && (
                  <p className="mt-1.5 text-xs text-red-600">The seller cannot be yourself.</p>
                )}
                {sellerSeen === false && isValidSellerAddress(expectedSeller) && (
                  <p className="mt-1.5 text-xs text-amber-700">
                    This wallet hasn&apos;t connected to ProofPay yet — make sure your seller has created an account first.
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <strong>12-hour secure link</strong>
                <p className="mt-1 text-amber-800">This escrow request expires automatically in 12 hours if funds are not locked.</p>
              </div>
            </div>
          </div>

          {error && <p className="mt-6 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}

          <div className="mt-6">
            <PrimaryButton
              onClick={handleCreateEscrow}
              disabled={
                submitting ||
                !expectedSeller.trim() ||
                !isValidSellerAddress(expectedSeller) ||
                expectedSeller.trim().toLowerCase() === walletAddress?.toLowerCase()
              }
            >
              {submitting ? "Creating Escrow..." : "Generate Secure Escrow Link"}
            </PrimaryButton>
          </div>
        </div>
      </main>
    </div>
  );
}

function InfoRow({ label, value, copyValue, copyable = false }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="flex items-center gap-2">
        <strong className="break-all text-right text-sm text-slate-900">{value || "—"}</strong>
        {copyable && copyValue && <CopyButton value={copyValue} />}
      </span>
    </div>
  );
}
