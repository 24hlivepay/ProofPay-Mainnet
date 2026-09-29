import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Contract, formatUnits } from "ethers";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { connectWallet, getCurrentWalletProvider } from "../services/wallet";
import { getEscrowAsset } from "../config/escrowAssets";
import { getNetworkConfig } from "../config/network";

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Swap is an App Kit SDK capability (same package Onramp already uses),
// not a separate SDK: no server involvement for an EOA wallet -- the
// connected wallet's own provider becomes a Viem adapter and signs the
// swap directly, exactly like any other DEX frontend. Circle Wallets
// (email sign-in) need a different, server-mediated flow because their PIN
// approval can't happen through a browser-injected signer; that path isn't
// built yet, so this page (and its dashboard entry) is EOA-only for now.
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

  async function loadBalances() {
    if (isCircleWallet || !walletAddress) return;
    try {
      setBalancesLoading(true);
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
    // nothing to pay the transaction fee with.
    const reserve = getSwapTokenInfo(tokenIn, network.id).isNative ? 0.5 : 0;
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
    if (!amountIn || Number(amountIn) <= 0 || isCircleWallet || !walletAddress) {
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

  async function confirmSwap() {
    try {
      setStatus("swapping");
      setMessage("");
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
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-slate-700">You pay</label>
                  {formatBalance(tokenIn) !== null && (
                    <button
                      type="button"
                      onClick={fillMaxAmount}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Balance: {formatBalance(tokenIn)} {tokenIn} · Max
                    </button>
                  )}
                </div>
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
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-slate-700">You receive</label>
                  {formatBalance(tokenOut) !== null && (
                    <span className="text-xs text-slate-500">
                      Balance: {formatBalance(tokenOut)} {tokenOut}
                    </span>
                  )}
                </div>
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

              {estimate && (
                <div className="space-y-1 text-xs text-slate-500">
                  {estimate.stopLimit && (
                    <p>Minimum received: {estimate.stopLimit.amount} {estimate.stopLimit.token}</p>
                  )}
                  {estimate.fees?.length > 0 && (
                    <p>Fees: {estimate.fees.map((fee) => `${fee.amount} ${fee.token} (${fee.type})`).join(", ")}</p>
                  )}
                </div>
              )}

              {status === "swapping" ? (
                <PrimaryButton disabled>Waiting for your wallet...</PrimaryButton>
              ) : (
                <PrimaryButton
                  onClick={confirmSwap}
                  disabled={status !== "ready"}
                >
                  {status === "estimating" ? "Getting quote..." : !amountIn ? "Enter an amount" : "Swap"}
                </PrimaryButton>
              )}

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
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
