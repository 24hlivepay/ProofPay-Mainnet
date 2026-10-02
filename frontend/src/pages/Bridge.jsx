import { useEffect, useRef, useState } from "react";
import { AppKit } from "@circle-fin/app-kit";
import * as SDK_CHAINS from "@circle-fin/app-kit/chains";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { Contract, JsonRpcProvider, formatUnits } from "ethers";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import SwapBridgeTabs from "../components/SwapBridgeTabs";
import DetailRow from "../components/DetailRow";
import ProgressDialog from "../components/ProgressDialog";
import { recordActivity } from "../services/activity";
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
      // Avalanche is left out on purpose: Circle's CCTPx registry has EURC
      // switched off there (quote answers TOKEN_NOT_SUPPORTED_ON_ROUTE, both
      // directions), so listing it only produced a "quote failed" error.
      EURC: ["Ethereum", "Base"],
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

// "The amount typed is the amount that arrives" changes which SDK path
// signs the transfer. It runs on testnet first; mainnet keeps the default
// fee handling until a real wallet-signed bridge has confirmed it there.
const RECEIVE_EXACT_MAINNET_ENABLED = false;

// The SDK ships a definition for every chain it supports (chain id, public
// RPC, USDC and EURC addresses, explorer). Indexed by its `chain` identifier -- the same
// string kit.bridge() takes -- so nothing here is a hand-copied address.
const CHAIN_INFO = Object.fromEntries(
  Object.values(SDK_CHAINS)
    .filter((entry) => entry && typeof entry === "object" && entry.chain && entry.chainId)
    .map((entry) => [entry.chain, entry])
);

const kit = new AppKit();

// The steps the progress dialog walks through, in order. "switch" is ours (the
// wallet changing network); the rest map onto the SDK's step names. The SDK
// emits an event once a step has finished, so a step's index + 1 is how many
// are done.
const PROGRESS_KEYS = ["switch", "approve", "send", "attest", "deliver"];

// What each finished step is called in the History list.
const STEP_LABELS = ["Network switch", "Approval", "Sent from source chain", "Circle confirmation", "Delivered on destination chain"];

function progressIndexForStep(name) {
  const lower = String(name || "").toLowerCase();
  if (/approve/.test(lower)) return 1;
  if (/burn|transfer/.test(lower)) return 2;
  if (/attest/.test(lower)) return 3;
  if (/mint/.test(lower)) return 4;
  return -1;
}

function linksFromSteps(steps) {
  const links = {};
  for (const step of steps || []) {
    const index = progressIndexForStep(step.name);
    if (index >= 0 && step.explorerUrl) links[PROGRESS_KEYS[index]] = step.explorerUrl;
  }
  return links;
}

// How many dialog steps a list of finished SDK steps covers. The wallet switch
// has always happened by the time there are any steps.
function progressFromSteps(steps) {
  const done = (steps || [])
    .filter((step) => step.state === "success")
    .map((step) => progressIndexForStep(step.name));
  return Math.max(1, ...done.map((index) => index + 1));
}

// The page promises "the amount you type is the amount that arrives", with
// the bridge fee paid on top. How that is achieved depends on the route:
//
//   sourcePaid  USDC into Arc. The SDK's own receive-exact option
//               (config.feePayment: "source"): the wallet pays amount + fee.
//               Confirmed with a real wallet-signed bridge only on these
//               chains -- the Quote API rejects it from every other source
//               chain with "Source-paid fees are not supported from <chain>"
//               (confirmed live from Arbitrum Sepolia, Optimism Sepolia,
//               Polygon Amoy, Avalanche Fuji). Checking the chain here,
//               not just the destination, avoids ever attempting (and
//               failing) the request on an unsupported chain.
//   grossUp     USDC out of Arc. The SDK refuses feePayment "source" from
//               Arc, and by default takes the relay fee out of what arrives.
//               The fee is a flat amount, so the page adds it to what is
//               sent: type 10, send 10.05, 10 arrives.
//   quoted      EURC (CCTPx). The fee is already quoted in the source
//               chain's gas token and paid on top; nothing to adjust.
//   deducted    USDC the default way: the fee comes out of what arrives.
//               Used on mainnet until receive-exact has been confirmed with
//               a real wallet on testnet, and on every testnet source chain
//               that doesn't support feePayment "source".
const SOURCE_PAID_CHAINS = new Set(["Base_Sepolia", "Ethereum_Sepolia", "Base", "Ethereum"]);

function feeMode(token, sourceChain, sourceIsArc, networkId) {
  if (token !== "USDC") return "quoted";
  if (networkId === "mainnet" && !RECEIVE_EXACT_MAINNET_ENABLED) return "deducted";
  if (sourceIsArc) return "grossUp";
  return SOURCE_PAID_CHAINS.has(sourceChain) ? "sourcePaid" : "deducted";
}

function sumFees(estimate, token) {
  return (estimate?.fees || [])
    .filter((fee) => fee.token === token)
    .reduce((total, fee) => total + Number(fee.amount || 0), 0);
}

// What a quote means for the user: what leaves the wallet in the bridged
// token, what arrives, and each fee line.
function summarizeQuote(quote, token, typedAmount) {
  if (!quote) return null;
  const { estimate, mode, sentAmount } = quote;
  const typed = Number(typedAmount);
  const sameTokenFee = sumFees(estimate, token);
  const fees = (estimate.fees || []).filter((fee) => Number(fee.amount || 0) > 0);

  if (mode === "sourcePaid") {
    return {
      fees,
      walletTotal: Number(estimate.totalDebit) || typed + sameTokenFee,
      receive: Number(estimate.amountReceived) || typed,
    };
  }
  if (mode === "grossUp") {
    return { fees, walletTotal: Number(sentAmount), receive: Number(sentAmount) - sameTokenFee };
  }
  return { fees, walletTotal: typed, receive: typed - sameTokenFee };
}

function trimAmount(value, digits = 6) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export default function Bridge() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const network = getNetworkConfig();
  const routes = BRIDGE_ROUTES[network.id];
  const isCircleWallet = (localStorage.getItem("proofpay-wallet-type") || "metamask") === "circle";
  const mainnetLocked = network.id === "mainnet" && !BRIDGE_MAINNET_ENABLED;
  const [direction, setDirection] = useState("toArc"); // toArc | fromArc
  const [token, setToken] = useState("USDC");
  const [otherChain, setOtherChain] = useState(routes.chains.USDC[1]);
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState("idle"); // idle | estimating | ready | bridging | done | error
  // { estimate, mode, sentAmount } -- see feeMode(). Named "estimate" for the
  // quote-refresh code shared with the Swap page.
  const [estimate, setEstimate] = useState(null);
  const [message, setMessage] = useState("");
  const [steps, setSteps] = useState([]);
  const [failedResult, setFailedResult] = useState(null);
  // Progress dialog: how many of PROGRESS_KEYS are finished, the explorer link
  // each step has produced so far, whether the dialog is showing, and what
  // this bridge is moving (a snapshot, because the form is cleared on success).
  const [progress, setProgress] = useState(0);
  const [stepLinks, setStepLinks] = useState({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogInfo, setDialogInfo] = useState(null);
  const [balances, setBalances] = useState({});
  // True while a bridge is in flight. A ref, not state: a second click that
  // lands before React re-renders the disabled button would otherwise start
  // a second approve + transfer for the same amount.
  const runningRef = useRef(false);
  // Set by the Max button, cleared when the user types an amount.
  const maxRequestedRef = useRef(false);

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

  // Leaving Arc with USDC, gas is paid out of the same balance -- keep a
  // small reserve (same reasoning as Swap's Max button).
  function gasReserve(raw) {
    return sourceChain === routes.arc && token === "USDC" ? Math.min(0.05, raw / 2) : 0;
  }

  function fillMaxAmount() {
    const raw = Number(balances[`${sourceChain}:${token}`] || 0);
    if (raw <= 0) return;
    // The fee is paid on top, so Max has to leave room for it. It is only
    // known once a quote is back; getEstimate() trims the amount then.
    maxRequestedRef.current = true;
    setAmount(String(Math.max(raw - gasReserve(raw), 0)));
    resetQuote();
  }

  async function buildAdapter() {
    const provider = await getCurrentWalletProvider();
    if (!provider) {
      throw new Error("Reconnect your wallet, then try again.");
    }
    return { adapter: await createViemAdapterFromProvider({ provider }), provider };
  }

  function buildBridgeParams(adapter, sentAmount, extraConfig = {}) {
    return {
      from: { adapter, chain: sourceChain },
      // Forwarder-only destination: Circle's relayer submits the mint, so
      // the user never needs gas on the destination chain and the wallet
      // only ever signs on the source chain.
      to: { chain: destinationChain, recipientAddress: walletAddress, useForwarder: true },
      amount: sentAmount,
      token,
      // Plain approve -> burn. EIP-5792 batching behaves differently from
      // wallet to wallet; the sequential flow is the predictable one.
      config: { batchTransactions: false, ...extraConfig },
    };
  }

  // Quotes the bridge so that `amount` is what arrives (see feeMode()).
  // Returns the params to hand to kit.bridge() along with the estimate.
  async function quoteBridge(adapter) {
    const mode = feeMode(token, sourceChain, sourceChain === routes.arc, network.id);

    if (mode === "sourcePaid") {
      try {
        const params = buildBridgeParams(adapter, amount, { feePayment: "source" });
        return { mode, params, sentAmount: amount, estimate: await kit.estimateBridge(params) };
      } catch (error) {
        // Backstop for SOURCE_PAID_CHAINS being wrong or going stale: fall
        // back to the SDK's default destination-paid fees (every chain
        // supports it) instead of failing the bridge outright.
        if (!/feePayment/i.test(error?.message || "")) throw error;
        const params = buildBridgeParams(adapter, amount);
        return { mode: "deducted", params, sentAmount: amount, estimate: await kit.estimateBridge(params) };
      }
    }

    if (mode === "grossUp") {
      // First quote tells us the fee; the second is for amount + fee, which
      // is what actually gets sent.
      const first = await kit.estimateBridge(buildBridgeParams(adapter, amount));
      const sentAmount = (Number(amount) + sumFees(first, token)).toFixed(6);
      const params = buildBridgeParams(adapter, sentAmount);
      const second = await kit.estimateBridge(params);
      // The fee service now and then answers with no fee lines at all (seen
      // on testnet). Keep whichever quote actually carries the fee, so the
      // page never shows a fee of 0 for an amount it has already grossed up.
      const estimate = sumFees(second, token) > 0 ? second : { ...second, fees: first.fees };
      return { mode, params, sentAmount, estimate };
    }

    const params = buildBridgeParams(adapter, amount);
    return { mode, params, sentAmount: amount, estimate: await kit.estimateBridge(params) };
  }

  async function getEstimate() {
    try {
      setStatus("estimating");
      setMessage("");
      const { adapter } = await buildAdapter();
      const { mode, sentAmount, estimate: result } = await quoteBridge(adapter);
      const quote = { mode, sentAmount, estimate: result };

      // Max was pressed before the fee was known: shrink the amount so the
      // amount plus the fee fits the balance, and quote again.
      const balance = Number(balances[`${sourceChain}:${token}`] || 0);
      const summary = summarizeQuote(quote, token, amount);
      if (maxRequestedRef.current && balance > 0 && summary.walletTotal + gasReserve(balance) > balance) {
        maxRequestedRef.current = false;
        const fee = summary.walletTotal - Number(amount);
        const fitted = Math.floor(Math.max(balance - gasReserve(balance) - fee, 0) * 1e6) / 1e6;
        if (fitted > 0 && fitted !== Number(amount)) {
          setAmount(String(fitted));
          return;
        }
      }

      setEstimate(quote);
      if (summary.receive <= 0) {
        setStatus("error");
        setMessage(`This amount is smaller than the bridge fee. Enter a larger amount.`);
        return;
      }
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      // A bare "request failed with status 400" from the fee-quote service
      // means that chain/token pair is not being served right now.
      setMessage(
        /status 400/i.test(error?.message || "")
          ? `${token} can't be bridged between ${sourceInfo.name} and ${destinationInfo.name} right now. Try another chain.`
          : error.message || "Could not get a quote for this bridge."
      );
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
  // asks the wallet to switch to it. EIP-3085 says a missing chain comes
  // back as error code 4902, which MetaMask follows -- but Rabby answers
  // with a plain "Unrecognized chain ID" message and no 4902 code
  // (confirmed live: it switched straight to Arbitrum/Avalanche, which it
  // already had, but rejected Optimism/Polygon this way), so the code check
  // alone missed it. Treat that message the same as 4902.
  async function ensureSourceChain(provider) {
    const chainHex = `0x${sourceInfo.chainId.toString(16)}`;
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      const isMissingChain = error?.code === 4902 || /unrecognized chain|unknown chain/i.test(error?.message || "");
      if (!isMissingChain) throw error;
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

  async function runBridge(action, { startProgress = 0 } = {}) {
    if (runningRef.current) return;
    runningRef.current = true;
    let provider;
    // The SDK emits an event when a step has finished, so the message moves to
    // the step that is now waiting.
    const NEXT_STEP = { approve: "burn", burn: "fetchAttestation", transfer: "fetchAttestation", fetchAttestation: "mint", reAttest: "mint" };
    const handleEvent = (payload) => {
      if (payload?.method) setMessage(describeStep(NEXT_STEP[payload.method] || payload.method));
      const index = progressIndexForStep(payload?.method);
      if (index >= 0) {
        setProgress((current) => Math.max(current, index + 1));
        const href = payload.values?.explorerUrl;
        if (href) setStepLinks((current) => ({ ...current, [PROGRESS_KEYS[index]]: href }));
      }
    };

    try {
      setStatus("bridging");
      setSteps([]);
      setFailedResult(null);
      setMessage(`Switching your wallet to ${sourceInfo.name}...`);

      const quoted = summarizeQuote(estimate, token, amount);
      setDialogInfo({
        token,
        sourceName: sourceInfo.name,
        destinationName: destinationInfo.name,
        sent: quoted ? quoted.walletTotal : Number(amount),
        received: quoted ? quoted.receive : null,
      });
      setProgress(startProgress);
      if (startProgress === 0) setStepLinks({});
      setDialogOpen(true);

      const built = await buildAdapter();
      provider = built.provider;
      await ensureSourceChain(provider);
      setProgress((current) => Math.max(current, 1));

      setMessage(describeStep("approve"));
      kit.on("*", handleEvent);
      const result = await action(built.adapter);
      setSteps(result?.steps || []);

      if (result?.state === "error") {
        setFailedResult(result);
        const stepList = result.steps || [];
        setProgress(progressFromSteps(stepList));
        setStepLinks((current) => ({ ...current, ...linksFromSteps(stepList) }));
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

      setProgress(PROGRESS_KEYS.length);
      setStepLinks((current) => ({ ...current, ...linksFromSteps(result?.steps) }));
      recordActivity({
        kind: "bridge",
        token,
        sourceChain: sourceInfo.name,
        destinationChain: destinationInfo.name,
        sent: String(quoted ? quoted.walletTotal : Number(result?.amount || amount)),
        received: quoted ? String(quoted.receive) : null,
        links: (result?.steps || [])
          .filter((step) => step.explorerUrl)
          .map((step) => ({ label: STEP_LABELS[progressIndexForStep(step.name)] || step.name, href: step.explorerUrl })),
      });
      // The dialog is the completion screen: it stays until the user presses
      // OK (also reopened if they had closed it while the bridge ran).
      setDialogOpen(true);
      setStatus("done");
      setMessage("");
      setAmount("");
      setEstimate(null);
      // The source balance updates once the transfer is in a block and the
      // destination a little later, so read both again a few times.
      [0, 4000, 12000, 30000].forEach((delay) => window.setTimeout(() => {
        loadBalance(sourceChain);
        loadBalance(destinationChain);
      }, delay));
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

  // Quote again at the moment of sending so the fee added on top is current.
  const confirmBridge = () => runBridge(async (adapter) => kit.bridge((await quoteBridge(adapter)).params));
  const retryBridge = () => runBridge(
    (adapter) => kit.retryBridge(failedResult, { from: adapter, to: adapter }),
    { startProgress: progressFromSteps(failedResult?.steps) }
  );

  const summary = summarizeQuote(estimate, token, amount);
  const receiveAmount = summary ? Math.max(summary.receive, 0) : null;
  const sourceBalance = balances[`${sourceChain}:${token}`];
  const destinationBalance = balances[`${destinationChain}:${token}`];
  const sourceGas = (estimate?.estimate?.gasFees || [])
    .reduce((total, gas) => total + Number(gas?.fees?.fee || 0), 0);

  // What must be in the wallet: the amount plus any fee in the same token.
  // Before a quote is back, only the typed amount is known.
  const walletTotal = summary ? summary.walletTotal : Number(amount || 0);
  const insufficient = sourceBalance !== undefined && walletTotal > Number(sourceBalance);
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

  // Closing the finished dialog is the user's OK: back to a clean form.
  function closeDialog() {
    setDialogOpen(false);
    if (status === "done") {
      setSteps([]);
      setStatus("idle");
    }
  }

  const dialogPhase = status === "done" ? "done" : status === "error" ? "error" : "running";
  const dialogSteps = dialogInfo
    ? [
        { key: "switch", label: `Switch to ${dialogInfo.sourceName}`, hint: "Approve the network switch in your wallet." },
        { key: "approve", label: `Approve ${dialogInfo.token}`, hint: "Confirm the approval in your wallet." },
        { key: "send", label: `Send ${dialogInfo.token} from ${dialogInfo.sourceName}`, hint: "Confirm the transfer in your wallet." },
        { key: "attest", label: "Circle confirms the transfer", hint: "Waiting for Circle. This can take a few minutes." },
        { key: "deliver", label: `Deliver to ${dialogInfo.destinationName}`, hint: "Circle sends it to your wallet." },
      ].map((step, index) => ({
        ...step,
        href: stepLinks[step.key],
        status: index < progress ? "done" : index === progress ? (dialogPhase === "error" ? "error" : "active") : "pending",
      }))
    : [];

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      {dialogInfo && (
        <ProgressDialog
          open={dialogOpen}
          phase={dialogPhase}
          title={
            dialogPhase === "done"
              ? "Bridge complete"
              : dialogPhase === "error"
                ? "Bridge stopped"
                : `Bridging ${trimAmount(dialogInfo.sent)} ${dialogInfo.token}`
          }
          from={{ amount: `${trimAmount(dialogInfo.sent)} ${dialogInfo.token}`, chain: dialogInfo.sourceName }}
          to={{
            amount: dialogInfo.received !== null ? `${trimAmount(dialogInfo.received)} ${dialogInfo.token}` : dialogInfo.token,
            chain: dialogInfo.destinationName,
          }}
          steps={dialogSteps}
          message={dialogPhase === "done" ? `Your ${dialogInfo.token} is on ${dialogInfo.destinationName}.` : message}
          note={
            progress >= 3
              ? "Your funds have left. You can close this window; the bridge finishes on its own."
              : "Keep this window open and confirm each prompt in your wallet."
          }
          closable={dialogPhase !== "running" || progress >= 3}
          onClose={closeDialog}
          onRetry={failedResult ? retryBridge : undefined}
        />
      )}
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
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
                      maxRequestedRef.current = false;
                      setAmount(event.target.value);
                      resetQuote();
                    }}
                    placeholder="0"
                    aria-label="Amount to bridge"
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
                  {summary.fees.map((fee) => (
                    <DetailRow
                      key={`${fee.type}-${fee.token}`}
                      label={fee.type === "provider" && summary.fees.length > 1 ? "Transfer fee" : "Bridge fee"}
                      value={`${trimAmount(fee.amount, 8)} ${fee.token}`}
                      note={
                        estimate.mode === "deducted"
                          ? "taken from the amount that arrives"
                          : `added on top, paid from your wallet on ${sourceInfo.name}`
                      }
                    />
                  ))}
                  {summary.walletTotal > Number(amount) && (
                    <DetailRow label="Total from your wallet" value={`${trimAmount(summary.walletTotal)} ${token}`} note="amount plus bridge fee" />
                  )}
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
                  <>
                    <PrimaryButton disabled>{message || "Waiting for your wallet..."}</PrimaryButton>
                    {!dialogOpen && (
                      <button type="button" onClick={() => setDialogOpen(true)} className="mt-3 w-full text-center text-sm font-semibold text-blue-600 hover:text-blue-700">
                        View progress
                      </button>
                    )}
                  </>
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
