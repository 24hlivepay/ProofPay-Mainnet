import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Contract, formatUnits } from "ethers";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import SwapBridgeTabs from "../components/SwapBridgeTabs";
import DetailRow from "../components/DetailRow";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { connectWallet, getCircleAuthSession, getCurrentWalletProvider, getWalletSession } from "../services/wallet";
import { executeCircleChallenge } from "../circle/circleConfig";
import { getEscrowAsset } from "../config/escrowAssets";
import { getNetworkConfig } from "../config/network";
import api from "../services/api";

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Swap is an App Kit SDK capability (same package Onramp already uses).
// EOA wallets (MetaMask, Rabby, etc.) run it entirely client-side -- the
// connected wallet's own provider becomes a Viem adapter and signs the
// swap directly, exactly like any other DEX frontend. Circle wallets
// (email sign-in) can't sign through a browser-injected provider, so their
// swap runs server-side as a background job (see POST /api/swap/circle in
// server.js -- calls LI.FI's public quote API directly + the existing
// lightweight Circle contract-execution REST calls, not the App Kit SDK,
// which pulled in an unrelated ~38MB Solana dependency that crashed the
// whole Vercel function) while this page polls for a PIN-approval
// challengeId and hands it to executeCircleChallenge() -- the same Web SDK
// call already used for transfers/contract-execution.
//
// On Arc, Swap accepts USDC, EURC, and cirBTC (see
// https://docs.arc.io/app-kit/swap) -- the actual swap call just takes
// these as token alias strings; App Kit resolves the real address itself.
// A contract address is only needed here for the balanceOf() display below.
const SWAP_TOKENS = ["USDC", "EURC", "cirBTC"];

// cirBTC deliberately isn't in config/escrowAssets.js: that file is
// ProofPay's escrow-contract asset support (deposit/release), and no
// ProofPay escrow exists for cirBTC -- adding it there would wrongly offer
// it as a createEscrow asset. This is only for the balance line here.
// Addresses verified on explorer.arc.io / explorer.testnet.arc.io: of
// several tokens sharing the "cirBTC" name (a common impersonation
// pattern), these are the dominant ones by holders/market cap by a wide
// margin, and the mainnet listing's website field is www.circle.com.
const CIRBTC_INFO = {
  mainnet: { tokenAddress: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", decimals: 8 },
  testnet: { tokenAddress: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF", decimals: 8 },
};

// USDC/EURC come from the shared escrow asset config (already verified
// there); cirBTC comes from CIRBTC_INFO above. Returns the same shape
// either way: { isNative, tokenAddress, decimals }.
function getSwapTokenInfo(symbol, networkId) {
  if (symbol === "cirBTC") {
    return { isNative: false, ...CIRBTC_INFO[networkId] };
  }
  return getEscrowAsset(symbol, networkId);
}

const kit = new AppKit();

// App Kit labels each fee line with a type; these are the names shown.
const FEE_LABELS = { provider: "Swap fee", gas: "Network fee" };

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
  const [balances, setBalances] = useState({});
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [prices, setPrices] = useState({});
  // True while a swap is in flight, so a second click that lands before
  // React re-renders the disabled button cannot start a second swap (the
  // same guard Bridge.jsx uses, added after a real double run there).
  const runningRef = useRef(false);

  async function loadPrices() {
    // Testnet tokens have no real market value, so there's nothing
    // meaningful to show there -- USD display is mainnet-only.
    if (network.id !== "mainnet") return;
    try {
      const entries = await Promise.all(
        SWAP_TOKENS.map(async (symbol) => {
          const { tokenAddress } = getSwapTokenInfo(symbol, network.id);
          const response = await fetch(`${network.explorerBase}/api/v2/tokens/${tokenAddress}`);
          const data = await response.json();
          return [symbol, Number(data?.exchange_rate) || null];
        })
      );
      setPrices(Object.fromEntries(entries));
    } catch {
      // USD display is a convenience -- the swap flow itself doesn't need it.
    }
  }

  useEffect(() => {
    loadPrices();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatUsd(symbol, amount) {
    const price = prices[symbol];
    const value = Number(amount);
    if (!price || !value) return null;
    return (price * value).toLocaleString(undefined, { style: "currency", currency: "USD" });
  }

  async function loadBalances() {
    if (!walletAddress) return;
    try {
      setBalancesLoading(true);

      if (isCircleWallet) {
        const session = getWalletSession();
        const auth = getCircleAuthSession();
        if (!session?.walletId || !auth?.userToken) return;
        const response = await api.get(`/circle/wallets/${session.walletId}/balances`, {
          headers: { "X-User-Token": auth.userToken },
        });
        const tokenBalances = response.data.data?.tokenBalances || [];
        const next = {};
        for (const symbol of SWAP_TOKENS) {
          // A token the wallet has never held has no entry in Circle's
          // response at all -- explicitly "0", not left unset, so its
          // Balance/Max line still renders (and shows 0) instead of
          // silently disappearing.
          const match = tokenBalances.find((item) => item?.token?.symbol === symbol);
          next[symbol] = match ? match.amount : "0";
        }
        setBalances(next);
        return;
      }

      const { address, provider } = await connectWallet();
      const next = {};
      for (const symbol of SWAP_TOKENS) {
        const asset = getSwapTokenInfo(symbol, network.id);
        // USDC is Arc's native gas currency (18 decimals, provider.getBalance),
        // not a regular ERC20 -- see network.js' nativeCurrency.
        next[symbol] = asset.isNative
          ? formatUnits(await provider.getBalance(address), 18)
          : formatUnits(
              await new Contract(asset.tokenAddress, BALANCE_ABI, provider).balanceOf(address),
              asset.decimals
            );
      }
      setBalances(next);
    } catch {
      // Balance display is a convenience -- the swap flow itself still
      // works even if this fails (e.g. a stale/disconnected provider).
    } finally {
      setBalancesLoading(false);
    }
  }

  useEffect(() => {
    loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, isCircleWallet]);

  function formatBalance(symbol) {
    const value = balances[symbol];
    if (value === undefined) return balancesLoading ? "..." : null;
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
  }

  function fillMaxAmount() {
    const raw = Number(balances[tokenIn] || 0);
    if (raw <= 0) return;
    // tokenIn === the native asset means gas for this very swap is paid out
    // of the same balance -- reserve a small buffer so "Max" doesn't leave
    // nothing to pay the transaction fee with. Real observed gas on Arc is
    // a few cents (0.02-0.05 USDC); a flat 0.5 reserve zeroed out Max on a
    // real 0.16 USDC balance. Cap the reserve at half the balance so a
    // small balance still gets a usable (non-zero) Max instead of 0.
    const isNative = getSwapTokenInfo(tokenIn, network.id).isNative;
    const reserve = isNative ? Math.min(0.05, raw / 2) : 0;
    const max = Math.max(raw - reserve, 0);
    setAmountIn(String(max));
    setEstimate(null);
    setStatus("idle");
  }

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

  function buildSwapParams(adapter) {
    return {
      from: { adapter, chain: network.id === "mainnet" ? "Arc" : "Arc_Testnet" },
      tokenIn,
      tokenOut,
      amountIn,
      // App Kit's default is "permit" (falling back to "approve" only if
      // permit fails) -- a real swap here reverted with InsufficientAllowance
      // (Solidity custom error 0x13be252b, decoded via 4byte.directory),
      // meaning the permit attempt wasn't actually falling back. Forcing
      // "approve" skips the broken permit path and goes straight to a
      // plain on-chain approve + swap.
      config: { allowanceStrategy: "approve" },
    };
  }

  async function getEstimate() {
    if (!amountIn || Number(amountIn) <= 0) {
      setEstimate(null);
      setStatus("idle");
      return;
    }

    try {
      setStatus("estimating");
      setMessage("");

      if (isCircleWallet) {
        const session = getWalletSession();
        const auth = getCircleAuthSession();
        if (!session?.walletId || !auth?.userToken) {
          throw new Error("Your Circle wallet session has expired. Sign in with email again.");
        }
        const response = await api.post(
          "/swap/circle/estimate",
          { walletId: session.walletId, walletAddress: session.address, tokenIn, tokenOut, amountIn },
          { headers: { "X-User-Token": auth.userToken } }
        );
        setEstimate(response.data);
        setStatus("ready");
        return;
      }

      const adapter = await buildAdapter();
      const result = await kit.estimateSwap(buildSwapParams(adapter));
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

  // Quote refreshes automatically as the user types (debounced), the way a
  // normal swap app works -- no separate "Get quote" step. Re-runs whenever
  // the amount or either token changes.
  useEffect(() => {
    if (!amountIn || Number(amountIn) <= 0 || !walletAddress) {
      setEstimate(null);
      if (status !== "swapping" && status !== "done") setStatus("idle");
      return undefined;
    }

    const timer = window.setTimeout(() => {
      getEstimate();
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amountIn, tokenIn, tokenOut, walletAddress, isCircleWallet]);

  async function confirmCircleSwap() {
    const session = getWalletSession();
    const auth = getCircleAuthSession();
    if (!session?.walletId || !auth?.userToken) {
      throw new Error("Your Circle wallet session has expired. Sign in with email again.");
    }

    const startResponse = await api.post(
      "/swap/circle",
      { walletId: session.walletId, walletAddress: session.address, tokenIn, tokenOut, amountIn },
      { headers: { "X-User-Token": auth.userToken } }
    );
    const jobId = startResponse.data.jobId;

    // A Circle-wallet swap is two challenges in sequence -- approve, then
    // the swap itself -- each with its own challengeId. Track which ones
    // this loop has already handed to the Web SDK by id (not a boolean) so
    // the second, distinct challengeId still gets picked up.
    const handledChallengeIds = new Set();
    for (let attempt = 0; attempt < 180; attempt += 1) {
      const poll = await api.get(`/swap/circle/${jobId}`, {
        headers: { "X-User-Token": auth.userToken },
      });
      const job = poll.data;

      if (job.status === "awaiting-approval" && job.challengeId && !handledChallengeIds.has(job.challengeId)) {
        handledChallengeIds.add(job.challengeId);
        setMessage(
          job.step === "approve"
            ? `Approve access to your ${tokenIn} with your PIN...`
            : "Approve this swap with your PIN..."
        );
        await executeCircleChallenge({
          challengeId: job.challengeId,
          userToken: auth.userToken,
          encryptionKey: auth.encryptionKey,
          display: {
            title: job.step === "approve" ? "Allow swap" : "Swap",
            subtitle:
              job.step === "approve"
                ? `Allow the swap to use your ${tokenIn}.`
                : `Swap ${amountIn} ${tokenIn} for ${tokenOut} on ${network.chainName}.`,
            amount: amountIn,
            symbol: tokenIn,
            confirmLabel: job.step === "approve" ? "Allow" : `Swap ${amountIn} ${tokenIn}`,
            action: job.step === "approve" ? "Approve" : "Swap",
          },
        });
        setMessage("Finishing your swap...");
      }

      if (job.status === "done") return job.result;
      if (job.status === "error") throw new Error(job.error);

      await new Promise((resolve) => window.setTimeout(resolve, 1500));
    }

    throw new Error("The swap is still processing. Check your wallet activity before retrying.");
  }

  async function confirmSwap() {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      setStatus("swapping");
      setMessage("");

      if (isCircleWallet) {
        const result = await confirmCircleSwap();
        setTxHash(result?.transactionHash || "");
        setStatus("done");
        loadBalances();
        return;
      }

      const adapter = await buildAdapter();
      const result = await kit.swap(buildSwapParams(adapter));
      setTxHash(result?.transactionHash || result?.hash || "");
      setStatus("done");
      loadBalances();
    } catch (error) {
      setStatus("error");
      setMessage(
        error.response?.data?.message ||
        error.message ||
        "The swap did not go through."
      );
    } finally {
      runningRef.current = false;
    }
  }

  const busy = status === "swapping";
  const balanceIn = balances[tokenIn];
  const insufficient = balanceIn !== undefined && Number(amountIn) > Number(balanceIn);
  const outputAmount = estimate?.estimatedOutput?.amount;

  let buttonLabel = `Swap ${tokenIn} for ${tokenOut}`;
  if (!amountIn || Number(amountIn) <= 0) buttonLabel = "Enter an amount";
  else if (insufficient) buttonLabel = `Not enough ${tokenIn}`;
  else if (status === "estimating") buttonLabel = "Getting quote...";

  const tokenPicker = (value, onChange, otherToken, label) => (
    <select
      value={value}
      disabled={busy}
      onChange={(event) => {
        onChange(event.target.value);
        setEstimate(null);
        setStatus("idle");
      }}
      className="shrink-0 cursor-pointer rounded-lg bg-transparent py-1 pr-1 text-lg font-bold text-slate-900 focus:outline-none"
      aria-label={label}
    >
      {SWAP_TOKENS.map((symbol) => (
        <option key={symbol} value={symbol} disabled={symbol === otherToken}>
          {symbol}
        </option>
      ))}
    </select>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h1 className="sr-only">Swap</h1>
          <SwapBridgeTabs active="swap" disabled={busy} />
          <p className="mt-4 text-sm text-slate-500">
            Exchange USDC, EURC and cirBTC on {network.chainName}.
          </p>

          {!walletAddress ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Connect your wallet first, then come back to this page.
            </p>
          ) : (
            <div className="mt-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 focus-within:border-blue-500">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">You pay</span>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={amountIn}
                    disabled={busy}
                    onChange={(event) => {
                      setAmountIn(event.target.value);
                      setEstimate(null);
                      setStatus("idle");
                    }}
                    placeholder="0"
                    aria-label="Amount to pay"
                    className="w-full min-w-0 [appearance:textfield] bg-transparent text-3xl font-semibold text-slate-900 placeholder:text-slate-300 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  {tokenPicker(tokenIn, setTokenIn, tokenOut, "Token to pay")}
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={insufficient ? "font-semibold text-red-600" : "text-slate-500"}>
                    Balance: {formatBalance(tokenIn) ?? "—"} {tokenIn}
                    {formatUsd(tokenIn, amountIn) && <span className="text-slate-400"> · {formatUsd(tokenIn, amountIn)}</span>}
                  </span>
                  {Number(balanceIn) > 0 && (
                    <button
                      type="button"
                      onClick={fillMaxAmount}
                      disabled={busy}
                      className="rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-700 hover:bg-blue-50"
                    >
                      Max
                    </button>
                  )}
                </div>
              </div>

              <div className="relative z-10 -my-3 flex justify-center">
                <button
                  type="button"
                  onClick={swapDirection}
                  disabled={busy}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-600 shadow-sm hover:bg-slate-50"
                  aria-label="Reverse swap direction"
                >
                  ⇅
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">You receive</span>
                <div className="mt-3 flex items-center gap-3">
                  <p
                    className={`w-full min-w-0 truncate text-3xl font-semibold ${
                      outputAmount ? "text-slate-900" : "text-slate-300"
                    }`}
                    aria-label="Amount you receive"
                  >
                    {outputAmount || (status === "estimating" ? "..." : "0")}
                  </p>
                  {tokenPicker(tokenOut, setTokenOut, tokenIn, "Token to receive")}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Balance: {formatBalance(tokenOut) ?? "—"} {tokenOut}
                  {formatUsd(tokenOut, outputAmount) && <span className="text-slate-400"> · {formatUsd(tokenOut, outputAmount)}</span>}
                </div>
              </div>

              {estimate && (estimate.stopLimit || estimate.fees?.length > 0) && (
                <dl className="mt-4 space-y-2 rounded-2xl border border-slate-200 p-4 text-sm">
                  {estimate.stopLimit && (
                    <DetailRow label="Minimum received" value={`${estimate.stopLimit.amount} ${estimate.stopLimit.token}`} />
                  )}
                  {(estimate.fees || []).map((fee) => (
                    <DetailRow
                      key={`${fee.type}-${fee.token}`}
                      label={FEE_LABELS[fee.type] || "Fee"}
                      value={`${Number(fee.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${fee.token}`}
                    />
                  ))}
                </dl>
              )}

              <div className="mt-4">
                {busy ? (
                  <PrimaryButton disabled>{message || "Waiting for your wallet..."}</PrimaryButton>
                ) : (
                  <PrimaryButton onClick={confirmSwap} disabled={status !== "ready" || insufficient}>
                    {buttonLabel}
                  </PrimaryButton>
                )}
              </div>

              {status === "error" && (
                <div className="mt-4">
                  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{message}</p>
                  <div className="mt-3">
                    <PrimaryButton onClick={() => setStatus("idle")}>Try again</PrimaryButton>
                  </div>
                </div>
              )}

              {status === "done" && (
                <p className="mt-4 rounded-xl bg-green-50 p-4 text-sm text-green-800">
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
              )}

              <p className="mt-4 text-center text-xs text-slate-400">
                Your wallet signs the swap itself — ProofPay never holds your funds.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
