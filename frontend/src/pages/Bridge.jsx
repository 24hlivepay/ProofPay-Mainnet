import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import * as SDK_CHAINS from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { ensureArcNetwork, getCurrentWalletProvider } from "../services/wallet";
import { getNetworkConfig } from "../config/network";

const BALANCE_ABI = ["function balanceOf(address account) view returns (uint256)"];

// Bridge is an App Kit SDK capability (same package Swap and Onramp use) on
// top of Circle's CCTP: USDC is burned on the source chain and minted on the
// destination chain, so there is no wrapped token and no liquidity pool.
// EOA wallets only for now -- the connected wallet's own provider becomes a
// Viem adapter and signs the approve + burn on the source chain. Circle
// (email sign-in) wallets need a server-side flow like Swap's and are not
// wired up yet.
//
// Every route here was checked with kit.estimateBridge() against both
// networks before being listed (Arc <-> each chain, forwarder on).
const BRIDGE_ROUTES = {
  mainnet: {
    arc: "Arc",
    others: ["Ethereum", "Base", "Arbitrum", "Optimism", "Polygon", "Avalanche"],
  },
  testnet: {
    arc: "Arc_Testnet",
    others: [
      "Ethereum_Sepolia",
      "Base_Sepolia",
      "Arbitrum_Sepolia",
      "Optimism_Sepolia",
      "Polygon_Amoy_Testnet",
      "Avalanche_Fuji",
    ],
  },
};

// The SDK ships a definition for every chain it supports (chain id, public
// RPC, USDC address, explorer). Indexed by its `chain` identifier -- the same
// string kit.bridge() takes -- so nothing here is a hand-copied address.
const CHAIN_INFO = Object.fromEntries(
  Object.values(SDK_CHAINS)
    .filter((entry) => entry && typeof entry === "object" && entry.chain && entry.chainId)
    .map((entry) => [entry.chain, entry])
);

const kit = new AppKit();

function sumUsdcFees(estimate) {
  return (estimate?.fees || [])
    .filter((fee) => fee.token === "USDC")
    .reduce((total, fee) => total + Number(fee.amount || 0), 0);
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
  const [direction, setDirection] = useState("toArc"); // toArc | fromArc
  const [otherChain, setOtherChain] = useState(routes.others[1]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle"); // idle | estimating | ready | bridging | done | error
  const [estimate, setEstimate] = useState(null);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState([]);
  const [failedResult, setFailedResult] = useState(null);
  const [balances, setBalances] = useState({});

  const sourceChain = direction === "toArc" ? otherChain : routes.arc;
  const destinationChain = direction === "toArc" ? routes.arc : otherChain;
  const sourceInfo = CHAIN_INFO[sourceChain];
  const destinationInfo = CHAIN_INFO[destinationChain];
  const sourceGasToken = sourceInfo?.nativeCurrency?.symbol || "ETH";

  async function loadBalance(chain) {
    if (!walletAddress) return;
    const info = CHAIN_INFO[chain];
    if (!info) return;
    try {
      const provider = new JsonRpcProvider(info.rpcEndpoints[0], info.chainId, { staticNetwork: true });
      // USDC is Arc's native gas currency (18 decimals, getBalance), not a
      // regular ERC20 -- see network.js' nativeCurrency. Everywhere else it
      // is the usual 6-decimal ERC20.
      const value = chain === routes.arc
        ? formatUnits(await provider.getBalance(walletAddress), 18)
        : formatUnits(await new Contract(info.usdcAddress, BALANCE_ABI, provider).balanceOf(walletAddress), 6);
      setBalances((current) => ({ ...current, [chain]: value }));
    } catch {
      // Balance display is a convenience -- the bridge itself still works
      // if a public RPC is slow or rate-limited.
    }
  }

  useEffect(() => {
    loadBalance(sourceChain);
    loadBalance(destinationChain);
  }, [walletAddress, sourceChain, destinationChain]);

  function resetQuote() {
    setEstimate(null);
    setStatus("idle");
    setMessage("");
  }

  function fillMaxAmount() {
    const raw = Number(balances[sourceChain] || 0);
    if (raw <= 0) return;
    // Leaving Arc, gas is paid in USDC out of the same balance -- keep a
    // small reserve (same reasoning as Swap's Max button).
    const reserve = sourceChain === routes.arc ? Math.min(0.05, raw / 2) : 0;
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
      // only ever signs on the source chain. The relay fee comes out of the
      // amount that arrives.
      to: { chain: destinationChain, recipientAddress: walletAddress, useForwarder: true },
      amount,
      token: "USDC",
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
      if (Number(amount) <= sumUsdcFees(result)) {
        setStatus("error");
        setMessage(`This amount is smaller than the bridge fee (${trimAmount(sumUsdcFees(result))} USDC). Enter a larger amount.`);
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
    if (!amount || Number(amount) <= 0 || !walletAddress || isCircleWallet) {
      setEstimate(null);
      if (status !== "bridging" && status !== "done") setStatus("idle");
      return undefined;
    }

    const timer = window.setTimeout(() => {
      getEstimate();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [amount, direction, otherChain, walletAddress, isCircleWallet]);

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
    const labels = {
      approve: `Approve USDC in your wallet (${sourceInfo.name})...`,
      burn: `Confirm the transfer in your wallet (${sourceInfo.name})...`,
      fetchAttestation: "Waiting for Circle to confirm the transfer...",
      mint: `Delivering USDC on ${destinationInfo.name}...`,
    };
    return labels[method] || "Working on your bridge...";
  }

  async function runBridge(action) {
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
        const burned = (result.steps || []).some((step) => /burn/i.test(step.name) && step.state === "success");
        setStatus("error");
        setMessage(
          burned
            ? `Your USDC left ${sourceInfo.name} but has not arrived on ${destinationInfo.name} yet. Your funds are not lost. Press Retry to finish the delivery.`
            : "The bridge did not go through. Nothing was sent."
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

  const totalUsdcFees = sumUsdcFees(estimate);
  const receiveAmount = estimate ? Math.max(Number(amount) - totalUsdcFees, 0) : null;
  const sourceBalance = balances[sourceChain];
  const destinationBalance = balances[destinationChain];
  const sourceGas = (estimate?.gasFees || [])
    .reduce((total, gas) => total + Number(gas?.fees?.fee || 0), 0);

  const chainSelect = (
    <select
      value={otherChain}
      onChange={(event) => {
        setOtherChain(event.target.value);
        resetQuote();
      }}
      className="w-full rounded-xl border border-slate-300 px-3 py-3 font-semibold"
    >
      {routes.others.map((chain) => (
        <option key={chain} value={chain}>{CHAIN_INFO[chain]?.name || chain}</option>
      ))}
    </select>
  );
  const arcBox = (
    <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 font-semibold text-slate-700">
      {network.chainName}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-3xl font-bold text-slate-900">Bridge</h1>
          <p className="mt-2 text-slate-600">
            Move USDC between {network.chainName} and other blockchains with Circle's CCTP. Your
            wallet signs the transfer itself — ProofPay never holds your funds.
          </p>

          {!walletAddress ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Connect your wallet first, then come back to this page.
            </p>
          ) : isCircleWallet ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Bridge works with browser wallets like MetaMask for now. Support for email sign-in
              wallets is coming later.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              <div>
                <label className="text-sm font-semibold text-slate-700">From</label>
                <div className="mt-1">{direction === "toArc" ? chainSelect : arcBox}</div>
              </div>

              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    setDirection(direction === "toArc" ? "fromArc" : "toArc");
                    resetQuote();
                  }}
                  disabled={status === "bridging"}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-lg text-slate-500 hover:bg-slate-50"
                  aria-label="Reverse bridge direction"
                >
                  ⇅
                </button>
              </div>

              <div>
                <label className="text-sm font-semibold text-slate-700">To</label>
                <div className="mt-1">{direction === "toArc" ? arcBox : chainSelect}</div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-slate-700">You send</label>
                  {sourceBalance !== undefined && (
                    <button
                      type="button"
                      onClick={fillMaxAmount}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Balance: {trimAmount(sourceBalance, 4)} USDC · Max
                    </button>
                  )}
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amount}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      resetQuote();
                    }}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg focus:border-blue-500 focus:outline-none"
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-700">USDC</div>
                </div>
              </div>

              <div>
                <div className="flex items-baseline justify-between">
                  <label className="text-sm font-semibold text-slate-700">You receive</label>
                  {destinationBalance !== undefined && (
                    <span className="text-xs text-slate-500">
                      Balance: {trimAmount(destinationBalance, 4)} USDC
                    </span>
                  )}
                </div>
                <div className="mt-1 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={receiveAmount !== null ? trimAmount(receiveAmount) : ""}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-600"
                  />
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 font-semibold text-slate-700">USDC</div>
                </div>
              </div>

              {estimate && (
                <div className="space-y-1 text-xs text-slate-500">
                  <p>Bridge fee: {trimAmount(totalUsdcFees)} USDC (taken from the amount that arrives)</p>
                  {sourceGas > 0 && (
                    <p>Network fee on {sourceInfo.name}: about {trimAmount(sourceGas, 8)} {sourceGasToken}</p>
                  )}
                  <p>Arrives in your same wallet address on {destinationInfo.name}, usually within a few minutes.</p>
                </div>
              )}

              {sourceChain !== routes.arc && (
                <p className="text-xs text-slate-500">
                  You need a little {sourceGasToken} on {sourceInfo.name} to pay its network fee. Your
                  wallet will switch to {sourceInfo.name} for this transfer and back to {network.chainName} after.
                </p>
              )}

              {status === "bridging" ? (
                <PrimaryButton disabled>{message || "Waiting for your wallet..."}</PrimaryButton>
              ) : (
                <PrimaryButton onClick={confirmBridge} disabled={status !== "ready"}>
                  {status === "estimating" ? "Getting quote..." : !amount ? "Enter an amount" : "Bridge"}
                </PrimaryButton>
              )}

              {status === "error" && (
                <div>
                  <p className="rounded-xl bg-red-50 p-4 text-red-700">{message}</p>
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
                <p className="rounded-xl bg-green-50 p-4 text-green-800">
                  ✓ Bridge complete. Your USDC is on {destinationInfo.name}.
                </p>
              )}

              {steps.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-500">
                  {steps.map((step) => (
                    <li key={step.name}>
                      {step.state === "success" ? "✓" : step.state === "error" ? "✕" : "•"} {step.name}
                      {step.explorerUrl && (
                        <>
                          {" · "}
                          <a href={step.explorerUrl} target="_blank" rel="noreferrer" className="underline">
                            View on explorer
                          </a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
