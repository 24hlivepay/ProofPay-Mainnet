import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { getCurrentWalletProvider } from "../services/wallet";
import { getNetworkConfig } from "../config/network";

// Swap is an App Kit SDK capability (same package Onramp already uses),
// not a separate SDK: no server involvement for an EOA wallet -- the
// connected wallet's own provider becomes a Viem adapter and signs the
// swap directly, exactly like any other DEX frontend. Circle Wallets
// (email sign-in) need a different, server-mediated flow because their PIN
// approval can't happen through a browser-injected signer; that path isn't
// built yet, so this page (and its dashboard entry) is EOA-only for now.
//
// On Arc, Swap only accepts USDC, EURC, and cirBTC (see
// https://docs.arc.io/app-kit/swap); ProofPay's own escrow config only
// tracks USDC/EURC contract addresses today, so those are the only pair
// offered here.
const SWAP_TOKENS = ["USDC", "EURC"];

const kit = new AppKit();

export default function Swap() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const isCircleWallet = (localStorage.getItem("proofpay-wallet-type") || "metamask") === "circle";
  const [tokenIn, setTokenIn] = useState("USDC");
  const [tokenOut, setTokenOut] = useState("EURC");
  const [amountIn, setAmountIn] = useState("");
  const [status, setStatus] = useState("idle"); // idle | estimating | ready | swapping | done | error
  const [estimate, setEstimate] = useState(null);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  function swapDirection() {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setEstimate(null);
    setStatus("idle");
  }

  async function buildAdapter() {
    const provider = await getCurrentWalletProvider();
    if (!provider) {
      throw new Error("Reconnect your wallet, then try again.");
    }
    return createViemAdapterFromProvider({ provider });
  }

  async function getEstimate() {
    if (!amountIn || Number(amountIn) <= 0) return;

    try {
      setStatus("estimating");
      setMessage("");
      const adapter = await buildAdapter();
      const result = await kit.estimateSwap({
        from: { adapter, chain: network.id === "mainnet" ? "Arc" : "Arc_Testnet" },
        tokenIn,
        tokenOut,
        amountIn,
      });
      setEstimate(result);
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(
        error.response?.data?.message ||
        error.message ||
        "Could not get a quote for this swap."
      );
    }
  }

  async function confirmSwap() {
    try {
      setStatus("swapping");
      setMessage("");
      const adapter = await buildAdapter();
      const result = await kit.swap({
        from: { adapter, chain: network.id === "mainnet" ? "Arc" : "Arc_Testnet" },
        tokenIn,
        tokenOut,
        amountIn,
      });
      setTxHash(result?.transactionHash || result?.hash || "");
      setStatus("done");
    } catch (error) {
      setStatus("error");
      setMessage(
        error.response?.data?.message ||
        error.message ||
        "The swap did not go through."
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-3xl font-bold text-slate-900">Swap</h1>
          <p className="mt-2 text-slate-600">
            Exchange USDC and EURC directly from your {network.chainName} wallet. Your wallet signs
            the swap itself — ProofPay never holds your funds.
          </p>

          {!walletAddress ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Connect your wallet first, then come back to this page.
            </p>
          ) : isCircleWallet ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Swap isn't available for Circle email wallets yet -- it currently works with a
              connected wallet extension (MetaMask, Rabby, and others).
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">You pay</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amountIn}
                    onChange={(event) => {
                      setAmountIn(event.target.value);
                      setEstimate(null);
                      setStatus("idle");
                    }}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-blue-500 focus:outline-none"
                  />
                  <select
                    value={tokenIn}
                    onChange={(event) => {
                      setTokenIn(event.target.value);
                      setEstimate(null);
                      setStatus("idle");
                    }}
                    className="rounded-xl border border-slate-300 px-3 py-3 font-semibold"
                  >
                    {SWAP_TOKENS.map((symbol) => (
                      <option key={symbol} value={symbol} disabled={symbol === tokenOut}>
                        {symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={swapDirection}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 hover:bg-slate-50"
                  aria-label="Reverse swap direction"
                >
                  ⇅
                </button>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700">You receive</label>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={estimate?.estimatedOutput?.amount || ""}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-600"
                  />
                  <select
                    value={tokenOut}
                    onChange={(event) => {
                      setTokenOut(event.target.value);
                      setEstimate(null);
                      setStatus("idle");
                    }}
                    className="rounded-xl border border-slate-300 px-3 py-3 font-semibold"
                  >
                    {SWAP_TOKENS.map((symbol) => (
                      <option key={symbol} value={symbol} disabled={symbol === tokenIn}>
                        {symbol}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {estimate?.fees?.length > 0 && (
                <p className="text-xs text-slate-500">
                  Fees: {estimate.fees.map((fee) => `${fee.amount} ${fee.token} (${fee.type})`).join(", ")}
                </p>
              )}

              {status === "idle" || status === "estimating" ? (
                <PrimaryButton onClick={getEstimate} disabled={status === "estimating" || !amountIn}>
                  {status === "estimating" ? "Getting quote..." : "Get quote"}
                </PrimaryButton>
              ) : status === "ready" ? (
                <PrimaryButton onClick={confirmSwap}>
                  Confirm swap in your wallet
                </PrimaryButton>
              ) : status === "swapping" ? (
                <PrimaryButton disabled>Waiting for your wallet...</PrimaryButton>
              ) : null}

              {status === "error" && (
                <div>
                  <p className="rounded-xl bg-red-50 p-4 text-red-700">{message}</p>
                  <div className="mt-3">
                    <PrimaryButton onClick={() => setStatus("idle")}>Try again</PrimaryButton>
                  </div>
                </div>
              )}

              {status === "done" && (
                <div>
                  <p className="rounded-xl bg-green-50 p-4 text-green-800">
                    ✓ Swap submitted.
                    {txHash && (
                      <>
                        {" "}
                        <a
                          href={`${network.explorerBase}/tx/${txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          View on explorer
                        </a>
                      </>
                    )}
                  </p>
                  <div className="mt-3">
                    <PrimaryButton onClick={() => navigate("/dashboard")}>Back to Dashboard</PrimaryButton>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
