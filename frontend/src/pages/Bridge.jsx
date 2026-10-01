import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import * as SDK_CHAINS from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import SwapBridgeTabs from "../components/SwapBridgeTabs";
import DetailRow from "../components/DetailRow";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { ensureArcNetwork, getCurrentWalletProvider } from "../services/wallet";
import { getNetworkConfig } from "../config/network";

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Bridge is an App Kit SDK capability (same package Swap and Onramp use) on
// top of Circle's CCTP: the token is burned on the source chain and minted
// on the destination chain, so there is no wrapped token and no liquidity
// pool. EOA wallets only for now -- the connected wallet's own provider
// becomes a Viem adapter and signs the approve + transfer on the source
// chain. Circle (email sign-in) wallets need a server-side flow like Swap's
// and are not wired up yet.
//
// USDC routes through CCTP v2. EURC routes through CCTPx, which only exists
// where Circle issues EURC, so it has fewer chains. Every route here was
// checked with kit.estimateBridge() against both networks before being
// listed (Arc <-> each chain, forwarder on).
const BRIDGE_TOKENS = ["USDC", "EURC"];
const BRIDGE_ROUTES = {
  mainnet: {
    arc: "Arc",
    chains: {
      USDC: ["Ethereum", "Base", "Arbitrum", "Optimism", "Polygon", "Avalanche"],
      EURC: ["Ethereum", "Base", "Avalanche"],
    },
  },
  testnet: {
    arc: "Arc_Testnet",
    chains: {
      USDC: [
        "Ethereum_Sepolia",
        "Base_Sepolia",
        "Arbitrum_Sepolia",
        "Optimism_Sepolia",
        "Polygon_Amoy_Testnet",
        "Avalanche_Fuji",
      ],
      EURC: ["Ethereum_Sepolia", "Base_Sepolia", "Avalanche_Fuji"],
    },
  },
};

// Mainnet was held back until a real wallet-signed bridge was confirmed end
// to end on testnet (USDC, 2026-10-01). Set this back to false to switch
// mainnet off again without touching testnet.
const BRIDGE_MAINNET_ENABLED = true;

// The SDK ships a definition for every chain it supports (chain id, public
// RPC, USDC and EURC addresses, explorer). Indexed by its `chain` identifier -- the same
// string kit.bridge() takes -- so nothing here is a hand-copied address.
const CHAIN_INFO = Object.fromEntries(
  Object.values(SDK_CHAINS)
    .filter((entry) => entry && typeof entry === "object" && entry.chain && entry.chainId)
    .map((entry) => [entry.chain, entry])
);

const kit = new AppKit();

// A fee quoted in the bridged token comes out of the amount that arrives
// (USDC's forwarder fee). A fee quoted in anything else is paid on top, from
// the wallet on the source chain (EURC's fee is in the source chain's gas
// token: ETH on Base, USDC on Arc).
function splitFees(estimate, token) {
  const fees = estimate?.fees || [];
  const deducted = fees
    .filter((fee) => fee.token === token)
    .reduce((total, fee) => total + Number(fee.amount || 0), 0);
  const extra = fees.filter((fee) => fee.token !== token && Number(fee.amount || 0) > 0);
  return { deducted, extra };
}

function trimAmount(value, digits = 6) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function Bridge() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const routes = BRIDGE_ROUTES[network.id];
  const isCircleWallet = (localStorage.getItem("proofpay-wallet-type") || "metamask") === "circle";
  const mainnetLocked = network.id === "mainnet" && !BRIDGE_MAINNET_ENABLED;
  const [direction, setDirection] = useState("toArc"); // toArc | fromArc
  const [token, setToken] = useState("USDC");
  const [otherChain, setOtherChain] = useState(routes.chains.USDC[1]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle"); // idle | estimating | ready | bridging | done | error
  const [estimate, setEstimate] = useState(null);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState([]);
  const [failedResult, setFailedResult] = useState(null);
  const [balances, setBalances] = useState({});
  // True while a bridge is in flight. A ref, not state: a second click that
  // lands before React re-renders the disabled button would otherwise start
  // a second approve + transfer for the same amount.
  const runningRef = useRef(false);

  const sourceChain = direction === "toArc" ? otherChain : routes.arc;
  const destinationChain = direction === "toArc" ? routes.arc : otherChain;
  const sourceInfo = CHAIN_INFO[sourceChain];
  const destinationInfo = CHAIN_INFO[destinationChain];
  const sourceGasToken = sourceInfo?.nativeCurrency?.symbol || "ETH";

  async function loadBalance(chain) {
    if (!walletAddress) return;
    const info = CHAIN_INFO[chain];
    const tokenAddress = token === "EURC" ? info?.eurcAddress : info?.usdcAddress;
    if (!info || !tokenAddress) return;
    try {
      const provider = new JsonRpcProvider(info.rpcEndpoints[0], info.chainId, { staticNetwork: true });
      // USDC is Arc's native gas currency (18 decimals, getBalance), not a
      // regular ERC20 -- see network.js' nativeCurrency. Everything else
      // here (USDC off Arc, EURC everywhere) is a 6-decimal ERC20.
      const value = chain === routes.arc && token === "USDC"
        ? formatUnits(await provider.getBalance(walletAddress), 18)
        : formatUnits(await new Contract(tokenAddress, BALANCE_ABI, provider).balanceOf(walletAddress), 6);
      setBalances((current) => ({ ...current, [`${chain}:${token}`]: value }));
    } catch {
      // Balance display is a convenience -- the bridge itself still works
      // if a public RPC is slow or rate-limited.
    }
  }

  useEffect(() => {
    loadBalance(sourceChain);
    loadBalance(destinationChain);
  }, [walletAddress, sourceChain, destinationChain, token]);

  function resetQuote() {
    setEstimate(null);
    setStatus("idle");
    setMessage("");
  }

  function changeToken(nextToken) {
    setToken(nextToken);
    // EURC exists on fewer chains than USDC -- keep the chain if the new
    // token supports it, otherwise fall back to the first one that does.
    if (!routes.chains[nextToken].includes(otherChain)) {
      setOtherChain(routes.chains[nextToken][0]);
    }
    resetQuote();
  }

  function fillMaxAmount() {
    const raw = Number(balances[`${sourceChain}:${token}`] || 0);
    if (raw <= 0) return;
    // Leaving Arc with USDC, gas is paid out of the same balance -- keep a
    // small reserve (same reasoning as Swap's Max button).
    const reserve = sourceChain === routes.arc && token === "USDC" ? Math.min(0.05, raw / 2) : 0;
    setAmount(String(Math.max(raw - reserve, 0)));
    resetQuote();
  }

  async function buildAdapter() {
    const provider = await getCurrentWalletProvider();
    if (!provider) {
      throw new Error("Reconnect your wallet, then try again.");
    }
    return { adapter: await createViemAdapterFromProvider({ provider }), provider };
  }

  function buildBridgeParams(adapter) {
    return {
      from: { adapter, chain: sourceChain },
      // Forwarder-only destination: Circle's relayer submits the mint, so
      // the user never needs gas on the destination chain and the wallet
      // only ever signs on the source chain.
      to: { chain: destinationChain, recipientAddress: walletAddress, useForwarder: true },
      amount,
      token,
      // Plain approve -> burn. EIP-5792 batching behaves differently from
      // wallet to wallet; the sequential flow is the predictable one.
      config: { batchTransactions: false },
    };
  }

  async function getEstimate() {
    try {
      setStatus("estimating");
      setMessage("");
      const { adapter } = await buildAdapter();
      const result = await kit.estimateBridge(buildBridgeParams(adapter));
      setEstimate(result);
      const { deducted } = splitFees(result, token);
      if (Number(amount) <= deducted) {
        setStatus("error");
        setMessage(`This amount is smaller than the bridge fee (${trimAmount(deducted)} ${token}). Enter a larger amount.`);
        return;
      }
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage(error.message || "Could not get a quote for this bridge.");
    }
  }

  // Quote refreshes as the user types (debounced), like the Swap page. An
  // estimate only reads from public RPCs -- it never asks the wallet to
  // switch networks.
  useEffect(() => {
    if (!amount || Number(amount) <= 0 || !walletAddress || isCircleWallet || mainnetLocked) {
      setEstimate(null);
      if (status !== "bridging" && status !== "done") setStatus("idle");
      return undefined;
    }

    const timer = window.setTimeout(() => {
      getEstimate();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [amount, direction, otherChain, token, walletAddress, isCircleWallet]);

  // Most wallets only know the big chains out of the box. If the source
  // chain is missing, add it from the SDK's own definition before the SDK
  // asks the wallet to switch to it.
  async function ensureSourceChain(provider) {
    const chainHex = `0x${sourceInfo.chainId.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: chainHex,
          chainName: sourceInfo.name,
          nativeCurrency: sourceInfo.nativeCurrency,
          rpcUrls: [...sourceInfo.rpcEndpoints],
          blockExplorerUrls: [new URL(sourceInfo.explorerUrl.replace("{hash}", "")).origin],
        }],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    }
  }

  function describeStep(method) {
    const confirm = `Confirm the transfer in your wallet (${sourceInfo.name})...`;
    const labels = {
      approve: `Approve ${token} in your wallet (${sourceInfo.name})...`,
      burn: confirm,
      transfer: confirm,
      fetchAttestation: "Waiting for Circle to confirm the transfer...",
      mint: `Delivering ${token} on ${destinationInfo.name}...`,
    };
    return labels[method] || "Working on your bridge...";
  }

  async function runBridge(action) {
    if (runningRef.current) return;
    runningRef.current = true;
    let provider;
    const handleEvent = (payload) => {
      if (payload?.method) setMessage(describeStep(payload.method));
    };

    try {
      setStatus("bridging");
      setSteps([]);
      setFailedResult(null);
      setMessage(`Switching your wallet to ${sourceInfo.name}...`);

      const built = await buildAdapter();
      provider = built.provider;
      await ensureSourceChain(provider);

      setMessage(describeStep("approve"));
      kit.on("*", handleEvent);
      const result = await action(built.adapter);
      setSteps(result?.steps || []);

      if (result?.state === "error") {
        setFailedResult(result);
        const stepList = result.steps || [];
        const burned = stepList.some((step) => /burn|transfer/i.test(step.name) && step.state === "success");
        const failedStep = stepList.find((step) => step.state === "error");
        const reason = failedStep?.errorMessage ? ` Reason: ${String(failedStep.errorMessage).slice(0, 200)}` : "";
        setStatus("error");
        setMessage(
          burned
            ? `Your ${token} left ${sourceInfo.name} but has not arrived on ${destinationInfo.name} yet. Your funds are not lost. Press Retry to finish the delivery.`
            : `The bridge stopped${failedStep ? ` at the ${failedStep.name} step` : ""}. Nothing was sent.${reason}`
        );
        return;
      }

      setStatus("done");
      setMessage("");
      loadBalance(sourceChain);
      loadBalance(destinationChain);
    } catch (error) {
      setStatus("error");
      setMessage(
        error?.code === 4001 || /rejected|denied/i.test(error?.message || "")
          ? "You cancelled the request in your wallet. Nothing was sent."
          : error.message || "The bridge did not go through."
      );
    } finally {
      runningRef.current = false;
      kit.off("*", handleEvent);
      // The rest of ProofPay expects the wallet on Arc. A bridge from
      // another chain leaves it on that chain, so put it back.
      if (provider && sourceChain !== routes.arc) {
        try {
          await ensureArcNetwork(undefined, provider);
        } catch {
          // The next ProofPay action switches the wallet anyway.
        }
      }
    }
  }

  const confirmBridge = () => runBridge((adapter) => kit.bridge(buildBridgeParams(adapter)));
  const retryBridge = () => runBridge((adapter) => kit.retryBridge(failedResult, { from: adapter, to: adapter }));

  const { deducted: deductedFee, extra: extraFees } = splitFees(estimate, token);
  const receiveAmount = estimate ? Math.max(Number(amount) - deductedFee, 0) : null;
  const sourceBalance = balances[`${sourceChain}:${token}`];
  const destinationBalance = balances[`${destinationChain}:${token}`];
  const sourceGas = (estimate?.gasFees || [])
    .reduce((total, gas) => total + Number(gas?.fees?.fee || 0), 0);

  const insufficient = sourceBalance !== undefined && Number(amount) > Number(sourceBalance);
  const busy = status === "bridging";
  const shortAddress = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "";

  let buttonLabel = `Bridge ${trimAmount(amount || 0)} ${token}`;
  if (!amount || Number(amount) <= 0) buttonLabel = "Enter an amount";
  else if (insufficient) buttonLabel = `Not enough ${token} on ${sourceInfo.name}`;
  else if (status === "estimating") buttonLabel = "Getting quote...";

  const chainPicker = (
    <div className="flex items-center">
      <select
        value={otherChain}
        disabled={busy}
        onChange={(event) => {
          setOtherChain(event.target.value);
          resetQuote();
        }}
        className="cursor-pointer rounded-lg bg-transparent py-1 pr-1 text-sm font-bold text-slate-900 focus:outline-none"
        aria-label="Choose blockchain"
      >
        {routes.chains[token].map((chain) => (
          <option key={chain} value={chain}>{CHAIN_INFO[chain]?.name || chain}</option>
        ))}
      </select>
    </div>
  );
  const arcLabel = (
    <span className="py-1 text-sm font-bold text-slate-900">{network.chainName}</span>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <h1 className="sr-only">Bridge</h1>
          <SwapBridgeTabs active="bridge" disabled={busy} />
          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              Move USDC and EURC between {network.chainName} and other blockchains.
            </p>
            {!mainnetLocked && walletAddress && !isCircleWallet && (
              <div className="flex shrink-0 rounded-full bg-slate-100 p-1" role="tablist" aria-label="Token">
                {BRIDGE_TOKENS.map((symbol) => (
                  <button
                    key={symbol}
                    type="button"
                    role="tab"
                    aria-selected={token === symbol}
                    disabled={busy}
                    onClick={() => changeToken(symbol)}
                    className={
                      token === symbol
                        ? "rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-sm"
                        : "rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                    }
                  >
                    {symbol}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mainnetLocked ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Bridge is being tested on Arc Testnet first and will open on Arc Mainnet soon. Switch
              to Arc Testnet at the top of the page to try it.
            </p>
          ) : !walletAddress ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Connect your wallet first, then come back to this page.
            </p>
          ) : isCircleWallet ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Bridge works with browser wallets like MetaMask for now. Support for email sign-in
              wallets is coming later.
            </p>
          ) : (
            <div className="mt-5">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 focus-within:border-blue-500">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">From</span>
                  {direction === "toArc" ? chainPicker : arcLabel}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      resetQuote();
                    }}
                    placeholder="0"
                    aria-label="Amount to send"
                    className="w-full min-w-0 [appearance:textfield] bg-transparent text-3xl font-semibold text-slate-900 placeholder:text-slate-300 focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  <span className="shrink-0 text-lg font-bold text-slate-900">{token}</span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className={insufficient ? "font-semibold text-red-600" : "text-slate-500"}>
                    Balance: {sourceBalance !== undefined ? trimAmount(sourceBalance, 4) : "..."} {token}
                  </span>
                  {Number(sourceBalance) > 0 && (
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
                  onClick={() => {
                    setDirection(direction === "toArc" ? "fromArc" : "toArc");
                    resetQuote();
                  }}
                  disabled={busy}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-600 shadow-sm hover:bg-slate-50"
                  aria-label="Reverse bridge direction"
                >
                  ⇅
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">To</span>
                  {direction === "toArc" ? arcLabel : chainPicker}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <p
                    className={`w-full min-w-0 truncate text-3xl font-semibold ${
                      receiveAmount !== null ? "text-slate-900" : "text-slate-300"
                    }`}
                    aria-label="Amount you receive"
                  >
                    {receiveAmount !== null ? trimAmount(receiveAmount) : status === "estimating" ? "..." : "0"}
                  </p>
                  <span className="shrink-0 text-lg font-bold text-slate-900">{token}</span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Balance: {destinationBalance !== undefined ? trimAmount(destinationBalance, 4) : "..."} {token}
                </div>
              </div>

              {estimate && (
                <dl className="mt-4 space-y-2 rounded-2xl border border-slate-200 p-4 text-sm">
                  {deductedFee > 0 && (
                    <DetailRow label="Bridge fee" value={`${trimAmount(deductedFee)} ${token}`} note="taken from the amount that arrives" />
                  )}
                  {extraFees.map((fee) => (
                    <DetailRow
                      key={`${fee.type}-${fee.token}`}
                      label="Bridge fee"
                      value={`${trimAmount(fee.amount, 8)} ${fee.token}`}
                      note={`paid from your wallet on ${sourceInfo.name}`}
                    />
                  ))}
                  {sourceGas > 0 && (
                    <DetailRow label="Network fee" value={`~${trimAmount(sourceGas, 8)} ${sourceGasToken}`} note={`on ${sourceInfo.name}`} />
                  )}
                  <DetailRow label="Arrival time" value="A few minutes" />
                  <DetailRow label="Recipient" value={shortAddress} note={`your wallet on ${destinationInfo.name}`} />
                </dl>
              )}

              {sourceChain !== routes.arc && (
                <p className="mt-3 flex gap-2 text-xs leading-5 text-slate-500">
                  <span aria-hidden="true">ⓘ</span>
                  <span>
                    You need a little {sourceGasToken} on {sourceInfo.name} to pay its fees. Your wallet
                    switches to {sourceInfo.name} for this transfer and back to {network.chainName} after.
                  </span>
                </p>
              )}

              <div className="mt-4">
                {busy ? (
                  <PrimaryButton disabled>{message || "Waiting for your wallet..."}</PrimaryButton>
                ) : (
                  <PrimaryButton onClick={confirmBridge} disabled={status !== "ready" || insufficient}>
                    {buttonLabel}
                  </PrimaryButton>
                )}
              </div>

              {status === "error" && (
                <div className="mt-4">
                  <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{message}</p>
                  <div className="mt-3">
                    {failedResult ? (
                      <PrimaryButton onClick={retryBridge}>Retry</PrimaryButton>
                    ) : (
                      <PrimaryButton onClick={resetQuote}>Try again</PrimaryButton>
                    )}
                  </div>
                </div>
              )}

              {status === "done" && (
                <p className="mt-4 rounded-xl bg-green-50 p-4 text-sm text-green-800">
                  ✓ Bridge complete. Your {token} is on {destinationInfo.name}.
                </p>
              )}

              {steps.length > 0 && (
                <ul className="mt-4 space-y-2 rounded-2xl border border-slate-200 p-4 text-sm text-slate-600">
                  {steps.map((step) => (
                    <li key={step.name} className="flex items-center justify-between gap-3">
                      <span>
                        <span className={step.state === "error" ? "text-red-600" : "text-green-600"}>
                          {step.state === "success" ? "✓" : step.state === "error" ? "✕" : "•"}
                        </span>{" "}
                        {step.name}
                      </span>
                      {step.explorerUrl && (
                        <a href={step.explorerUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-blue-700 hover:underline">
                          View on explorer ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              <p className="mt-4 text-center text-xs text-slate-400">
                Powered by Circle CCTP. Your wallet signs the transfer — ProofPay never holds your funds.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
