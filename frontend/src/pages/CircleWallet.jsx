import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import CopyButton from "../components/CopyButton";
import { TokenLogo } from "../components/Logos";
import { shortenAddress } from "../utils/address";
import { useWalletBadge } from "../hooks/useWalletBadge";
import PrimaryButton from "../components/PrimaryButton";
import { sendCircleToken } from "../services/circleTransactions";
import {
  connectWallet,
  getCircleAuthSession,
  getConnectedWallet,
  getWalletSession,
  WALLET_DETAILS,
} from "../services/wallet";
import { Contract, formatUnits, parseUnits } from "ethers";
import api from "../services/api";
import { getEscrowAsset } from "../config/escrowAssets";
import { getCurrentNetworkId, getExplorerTxUrl, getNetworkConfig } from "../config/network";

const CIRCLE_FAUCET_URL = "https://faucet.circle.com/?allow=true";
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

// The three assets ProofPay knows by address. Anything else a wallet holds is
// listed under "Other tokens", and only these get a logo and a dollar value,
// so a look-alike token that merely calls itself "cirBTC" is never dressed up
// as the real one.
const CIRBTC_ADDRESS = {
  mainnet: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
  testnet: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
};

function getKnownTokens() {
  const networkId = getCurrentNetworkId();
  return [
    { symbol: "USDC", address: getEscrowAsset("USDC").tokenAddress, decimals: 6 },
    { symbol: "EURC", address: getEscrowAsset("EURC").tokenAddress, decimals: 6, name: "Euro Coin" },
    { symbol: "cirBTC", address: CIRBTC_ADDRESS[networkId], decimals: 8, name: "Circle Wrapped Bitcoin" },
  ];
}

// "USDC" | "EURC" | "cirBTC" if this asset is that exact token, else null.
function knownSymbolOf(asset) {
  const token = asset.token || {};
  const address = String(token.tokenAddress || "").toLowerCase();
  if (token.isNative && token.symbol === "USDC") return "USDC";
  const match = getKnownTokens().find((known) => known.address.toLowerCase() === address);
  return match ? match.symbol : null;
}

function AssetRow({ asset, price }) {
  const symbol = asset.token.symbol || "?";
  const known = knownSymbolOf(asset);
  const amount = Number(asset.amount || 0);
  const usd = known && price && amount ? price * amount : null;
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-bold text-blue-700">
          {known ? <TokenLogo symbol={known} /> : symbol.slice(0, 2)}
        </span>
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{asset.token.symbol || "Unknown token"}</p>
          <p className="truncate text-sm text-slate-500">
            {asset.token.name || asset.token.tokenAddress || "Arc asset"}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="font-bold text-slate-900">
          {amount.toLocaleString(undefined, { maximumFractionDigits: 8 })}
        </p>
        {usd !== null && (
          <p className="text-sm text-slate-500">
            {usd.toLocaleString(undefined, { style: "currency", currency: "USD" })}
          </p>
        )}
      </div>
    </div>
  );
}

// Every ERC20 the connected wallet actually holds on Arc, not just the
// handful ProofPay's escrow contracts know about (USDC/EURC) -- so a token
// acquired elsewhere, like cirBTC from Swap, still shows up here. Response
// shape (token.address_hash, token.decimals, value as a raw units string)
// confirmed against a real holder address on explorer.arc.io before relying
// on it, not assumed from Blockscout's general docs.
async function fetchHeldTokens(address, explorerBase) {
  const response = await fetch(`${explorerBase}/api/v2/addresses/${address}/token-balances`);
  if (!response.ok) return [];
  const balances = await response.json();

  // Arc exposes native USDC through an ERC20-interface precompile too (see
  // escrowAssets.js' USDC tokenAddress), so it shows up in this list a
  // second time alongside the real native balance below -- skip it here.
  const nativeUsdcPrecompile = getEscrowAsset("USDC").tokenAddress.toLowerCase();

  return balances
    .filter(
      (entry) =>
        entry.token?.type === "ERC-20" &&
        Number(entry.value) > 0 &&
        entry.token.address_hash?.toLowerCase() !== nativeUsdcPrecompile
    )
    .map((entry) => ({
      id: `arc-${entry.token.address_hash.toLowerCase()}`,
      symbol: entry.token.symbol,
      name: entry.token.name,
      tokenAddress: entry.token.address_hash,
      decimals: Number(entry.token.decimals),
      rawValue: entry.value,
    }));
}

// The wallet's recent transfers of the three known tokens, newest first, from
// the explorer (field names checked against a real address on explorer.arc.io:
// from.hash, to.hash, timestamp, token.{address_hash,symbol}, total.{value,
// decimals}, transaction_hash). Shaped like the Circle transaction list so the
// Activity tab can draw both the same way. Transfers of other tokens are left
// out: most of them are unsolicited airdrops.
async function fetchWalletTransfers(address, explorerBase) {
  const response = await fetch(`${explorerBase}/api/v2/addresses/${address}/token-transfers?type=ERC-20`);
  if (!response.ok) return [];
  const { items = [] } = await response.json();
  const known = new Set(getKnownTokens().map((token) => token.address.toLowerCase()));
  const me = address.toLowerCase();

  return items
    .filter((item) => known.has(String(item.token?.address_hash || "").toLowerCase()))
    .slice(0, 20)
    .map((item) => ({
      id: `${item.transaction_hash}-${item.log_index}`,
      transactionType: String(item.to?.hash || "").toLowerCase() === me ? "INBOUND" : "OUTBOUND",
      operation: "TRANSFER",
      createDate: item.timestamp,
      amounts: [formatUnits(item.total?.value || "0", Number(item.total?.decimals || item.token.decimals || 0))],
      token: { symbol: item.token.symbol },
      state: "COMPLETE",
      txHash: item.transaction_hash,
    }));
}

export default function CircleWallet() {
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const location = useLocation();
  const session = getWalletSession();
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const isCircleWallet = walletType === "circle";
  const address = isCircleWallet
    ? session?.address || ""
    : session?.address || getConnectedWallet() || "";
  const walletLabel = isCircleWallet
    ? "Circle Wallet"
    : WALLET_DETAILS[walletType]?.label || "MetaMask";
  const [view, setView] = useState(location.state?.view || "overview");
  const [assets, setAssets] = useState([]);
  const [activity, setActivity] = useState([]);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedTokenId, setSelectedTokenId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [copied, setCopied] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [prices, setPrices] = useState({});

  const loadBalance = useCallback(async () => {
    if (!address) return;

    try {
      setBalanceLoading(true);
      if (!isCircleWallet) {
        const [{ provider }, heldTokens] = await Promise.all([
          connectWallet(),
          fetchHeldTokens(address, getNetworkConfig().explorerBase),
        ]);
        const nativeBalance = await provider.getBalance(address);
        const nextAssets = [{
          token: {
            id: "arc-native-usdc",
            symbol: "USDC",
            name: `${getNetworkConfig().chainName} native USDC`,
            decimals: 18,
            isNative: true,
            standard: "NATIVE",
          },
          amount: formatUnits(nativeBalance, 18),
        }, ...heldTokens.map((token) => ({
          token: {
            ...token,
            isNative: false,
            standard: "ERC20",
          },
          amount: formatUnits(token.rawValue, token.decimals),
        }))];
        // The explorer's token list is an indexer and runs behind the chain, so
        // right after a swap it still shows the old balance. The known tokens
        // are read from the chain itself instead (as the Swap page does).
        for (const known of getKnownTokens().filter((token) => token.symbol !== "USDC")) {
          try {
            const raw = await new Contract(known.address, ERC20_ABI, provider).balanceOf(address);
            const index = nextAssets.findIndex(
              (asset) => asset.token.tokenAddress?.toLowerCase() === known.address.toLowerCase()
            );
            const fresh = {
              token: index >= 0
                ? nextAssets[index].token
                : {
                    id: `arc-${known.address.toLowerCase()}`,
                    symbol: known.symbol,
                    name: known.name,
                    tokenAddress: known.address,
                    decimals: known.decimals,
                    isNative: false,
                    standard: "ERC20",
                  },
              amount: formatUnits(raw, known.decimals),
            };
            if (index >= 0) nextAssets[index] = fresh;
            else nextAssets.push(fresh);
          } catch {
            // Keep what the explorer reported for this token.
          }
        }
        for (let i = nextAssets.length - 1; i >= 0; i -= 1) {
          if (!(Number(nextAssets[i].amount || 0) > 0)) nextAssets.splice(i, 1);
        }
        setAssets(nextAssets);
        setActivity(await fetchWalletTransfers(address, getNetworkConfig().explorerBase).catch(() => []));
        setSelectedTokenId((current) =>
          nextAssets.some((asset) => asset.token.id === current)
            ? current
            : nextAssets[0]?.token.id || ""
        );
        setError("");
        return;
      }

      if (!session?.walletId) return;
      const auth = getCircleAuthSession();
      if (!auth?.userToken) {
        throw new Error("Circle session expired.");
      }
      const headers = { "X-User-Token": auth.userToken };
      const [balancesResult, activityResult] = await Promise.allSettled([
        api.get(`/circle/wallets/${session.walletId}/balances`, { headers }),
        api.get("/circle/transactions", {
          headers,
          params: { walletId: session.walletId },
        }),
      ]);
      if (balancesResult.status === "rejected") {
        throw balancesResult.reason;
      }
      const balancesResponse = balancesResult.value;
      const rawAssets =
        balancesResponse.data.data?.tokenBalances
          ?.filter((item) => item?.token?.id)
          .sort((left, right) => {
            if (left.token.symbol === "USDC") return -1;
            if (right.token.symbol === "USDC") return 1;
            return Number(right.amount || 0) - Number(left.amount || 0);
          }) || [];
      const assetMap = new Map();

      for (const asset of rawAssets) {
        // Arc exposes native USDC and its system-contract representation as
        // separate Circle token records backed by the same balance. Present
        // them as one asset and prefer the native record for transfers.
        const key =
          asset.token.symbol === "USDC"
            ? "arc-native-usdc"
            : asset.token.tokenAddress?.toLowerCase() || asset.token.id;
        const existing = assetMap.get(key);

        if (!existing || (!existing.token.isNative && asset.token.isNative)) {
          assetMap.set(key, asset);
        }
      }

      const nextAssets = [...assetMap.values()];
      setAssets(nextAssets);
      setActivity(
        activityResult.status === "fulfilled"
          ? activityResult.value.data.data?.transactions || []
          : []
      );
      const firstSendableAsset = nextAssets.find(
        (asset) =>
          !["ERC721", "ERC1155"].includes(asset.token.standard) &&
          Number(asset.amount || 0) > 0
      );
      setSelectedTokenId(
        (current) =>
          nextAssets.some((asset) => asset.token.id === current)
            ? current
            : firstSendableAsset?.token?.id || ""
      );
      setError("");
    } catch {
      setError(`The ${getNetworkConfig().chainName} wallet data is temporarily unavailable.`);
    } finally {
      setBalanceLoading(false);
    }
  }, [address, isCircleWallet, session?.walletId]);

  useEffect(() => {
    const timeout = window.setTimeout(loadBalance, 0);
    return () => window.clearTimeout(timeout);
  }, [loadBalance]);

  // Dollar values come from the explorer's token rates; only mainnet has real
  // ones, and the page works without them.
  useEffect(() => {
    if (getCurrentNetworkId() !== "mainnet") return;
    let cancelled = false;
    (async () => {
      try {
        const entries = await Promise.all(
          getKnownTokens().map(async (known) => {
            const response = await fetch(`${getNetworkConfig().explorerBase}/api/v2/tokens/${known.address}`);
            const data = await response.json();
            return [known.symbol, Number(data?.exchange_rate) || null];
          })
        );
        if (!cancelled) setPrices(Object.fromEntries(entries));
      } catch {
        // No dollar values then.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyAddress() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function openView(nextView) {
    setView(nextView);
    setError("");
    setStatus("");
    setTransactionHash("");
  }

  function useMaximumAmount() {
    if (!selectedAsset) return;

    let maximumAmount = selectedAsset.amount;
    if (selectedAsset.token.isNative) {
      const decimals = Number(selectedAsset.token.decimals || 18);
      const balanceUnits = parseUnits(selectedAsset.amount, decimals);
      const feeReserve = parseUnits("0.01", decimals);
      maximumAmount =
        balanceUnits > feeReserve
          ? formatUnits(balanceUnits - feeReserve, decimals)
          : "0";
    }

    setAmount(maximumAmount);
    setError("");
  }

  async function handleSend(event) {
    event.preventDefault();
    const normalizedRecipient = recipient.trim();
    const normalizedAmount = amount.trim();
    const selectedAsset = assets.find(
      (asset) => asset.token.id === selectedTokenId
    );

    if (!/^0x[a-fA-F0-9]{40}$/.test(normalizedRecipient)) {
      setError("Enter a valid Arc wallet address.");
      return;
    }
    const decimalPlaces = Math.max(
      1,
      Math.min(Number(selectedAsset?.token?.decimals || 18), 18)
    );
    const amountPattern = new RegExp(`^\\d+(\\.\\d{1,${decimalPlaces}})?$`);
    if (
      !selectedAsset ||
      !amountPattern.test(normalizedAmount) ||
      Number(normalizedAmount) <= 0
    ) {
      setError(`Enter a valid ${selectedAsset?.token?.symbol || "token"} amount.`);
      return;
    }
    if (Number(normalizedAmount) > Number(selectedAsset.amount || 0)) {
      setError(`Your ${selectedAsset.token.symbol} balance is too low.`);
      return;
    }

    try {
      setSubmitting(true);
      setError("");
      setTransactionHash("");
      let transactionHash;
      if (isCircleWallet) {
        setStatus("Approve this transfer in Circle’s secure window.");
        const transaction = await sendCircleToken({
          destinationAddress: normalizedRecipient,
          amount: normalizedAmount,
          tokenId: selectedAsset.token.id,
          symbol: selectedAsset.token.symbol,
          onSubmitted: () => {
            setStatus("Transfer approved. Waiting for Arc confirmation...");
          },
        });
        transactionHash = transaction.hash;
      } else {
        setStatus(`Approve this transfer in ${walletLabel}.`);
        const { signer } = await connectWallet();
        const amountUnits = parseUnits(
          normalizedAmount,
          selectedAsset.token.decimals
        );
        const transaction = selectedAsset.token.isNative
          ? await signer.sendTransaction({
              to: normalizedRecipient,
              value: amountUnits,
            })
          : await new Contract(
              selectedAsset.token.tokenAddress,
              ERC20_ABI,
              signer
            ).transfer(normalizedRecipient, amountUnits);
        setStatus("Transfer submitted. Waiting for Arc confirmation...");
        const receipt = await transaction.wait();
        transactionHash = receipt.hash;
      }
      setTransactionHash(transactionHash);
      setStatus(
        `${normalizedAmount} ${selectedAsset.token.symbol} sent successfully.`
      );
      setAmount("");
      setRecipient("");
      await loadBalance();
    } catch (sendError) {
      setStatus("");
      setError(
        sendError.response?.data?.message ||
          sendError.message ||
          "The USDC transfer could not be completed."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const selectedAsset = assets.find(
    (asset) => asset.token.id === selectedTokenId
  );
  const displayedSelectedBalance = Number(
    selectedAsset?.amount || 0
  ).toLocaleString(undefined, {
    maximumFractionDigits:
      selectedAsset?.token?.symbol === "cirBTC" ? 8 : 4,
  });
  const sendableAssets = assets.filter(
    (asset) =>
      !["ERC721", "ERC1155"].includes(asset.token.standard) &&
      Number(asset.amount || 0) > 0
  );
  const mainAssets = useMemo(() => {
    const order = ["USDC", "EURC", "cirBTC"];
    return assets
      .filter((asset) => knownSymbolOf(asset))
      .sort((a, b) => order.indexOf(knownSymbolOf(a)) - order.indexOf(knownSymbolOf(b)));
  }, [assets]);
  const otherAssets = useMemo(() => assets.filter((asset) => !knownSymbolOf(asset)), [assets]);
  const pricedAssets = mainAssets.filter((asset) => prices[knownSymbolOf(asset)]);
  const totalUsd =
    getCurrentNetworkId() === "mainnet" && pricedAssets.length > 0
      ? pricedAssets.reduce((sum, asset) => sum + Number(asset.amount || 0) * prices[knownSymbolOf(asset)], 0)
      : null;
  // The open one of Deposit / Send is solid; on the Assets and Activity tabs
  // Deposit is the solid one.
  const actionButtonClass = (solid) =>
    `rounded-xl px-4 py-2.5 font-bold transition ${
      solid
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : "border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
    }`;
  const walletTabClass = (active) =>
    `rounded-full px-4 py-2 text-sm font-bold transition ${
      active ? "bg-blue-100 text-blue-700" : "text-slate-600 hover:bg-slate-100"
    }`;

  if (!address) {
    return (
      <div className="min-h-screen bg-slate-100">
        <Navbar walletSlot={walletSlot} />
        <main className="mx-auto max-w-xl px-5 py-12 text-center">
          <div className="rounded-2xl bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-bold">Wallet connection required</h1>
            <p className="mt-3 text-slate-600">
              Connect your wallet to open the ProofPay wallet workspace.
            </p>
            <button
              onClick={() => navigate("/")}
              className="mt-6 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white"
            >
              Connect wallet
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-1.5">
                <p className="font-mono text-xs text-slate-600">{shortenAddress(address)}</p>
                <CopyButton value={address} />
              </div>
              {totalUsd !== null ? (
                <>
                  <p className="mt-4 text-sm text-slate-500">Total balance</p>
                  <p className="text-3xl font-bold text-slate-900">
                    {totalUsd.toLocaleString(undefined, { style: "currency", currency: "USD" })}
                  </p>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  {getCurrentNetworkId() === "testnet"
                    ? "Test tokens have no market value."
                    : balanceLoading
                      ? "Loading balance..."
                      : ""}
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => openView("receive")}
                className={actionButtonClass(view !== "send")}
              >
                ↓ Deposit / Receive
              </button>
              <button
                onClick={() => openView("send")}
                className={actionButtonClass(view === "send")}
              >
                ↑ Send
              </button>
            </div>
          </div>
        </section>

        {view === "overview" || view === "activity" ? (
          <div className="mt-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Wallet">
            <button role="tab" aria-selected={view === "overview"} onClick={() => openView("overview")} className={walletTabClass(view === "overview")}>
              Assets
            </button>
            <button role="tab" aria-selected={view === "activity"} onClick={() => openView("activity")} className={walletTabClass(view === "activity")}>
              Activity
            </button>
            <button role="tab" aria-selected="false" onClick={() => navigate("/onramp")} className={walletTabClass(false)}>
              Buy crypto
            </button>
          </div>
        ) : (
          <button
            onClick={() => openView("overview")}
            className="mt-4 text-sm font-semibold text-blue-600 hover:text-blue-700"
          >
            ← Wallet
          </button>
        )}

        {status && (
          <p className="mt-5 rounded-xl bg-green-50 p-4 text-sm font-medium text-green-700">
            {status}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-5 rounded-xl bg-red-50 p-4 text-sm text-red-700">
            {error}
          </p>
        )}
        {transactionHash && (
          <a
            href={getExplorerTxUrl(transactionHash)}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block font-semibold text-blue-600 hover:text-blue-700"
          >
            View confirmed transaction ↗
          </a>
        )}

        {view === "receive" && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold text-slate-900">
              Deposit / Receive Tokens
            </h2>
            <p className="mt-2 leading-6 text-slate-600">
              Send only {getNetworkConfig().chainName} assets to this address. Tokens from
              another network can be permanently lost.
              {getCurrentNetworkId() === "testnet"
                ? " Test tokens have no financial value."
                : " These are real funds."}
            </p>
            <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-blue-600">
                Your deposit address
              </p>
              <p className="mt-3 break-all font-mono text-sm text-slate-900">
                {address}
              </p>
              <button
                onClick={copyAddress}
                className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                {copied ? "Address copied" : "Copy address"}
              </button>
            </div>
            {getCurrentNetworkId() === "testnet" && (
              <a
                href={CIRCLE_FAUCET_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex rounded-xl border border-blue-200 px-5 py-3 font-semibold text-blue-700 hover:bg-blue-50"
              >
                Get 20 test USDC from Circle Faucet ↗
              </a>
            )}
          </section>
        )}

        {view === "overview" && (
          <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-slate-900">Assets</h2>
              <button onClick={loadBalance} className="font-semibold text-blue-600 hover:text-blue-700">
                Refresh
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {!balanceLoading && assets.length === 0 && (
                <p className="py-6 text-center text-slate-500">
                  No {getNetworkConfig().chainName} assets detected yet.
                </p>
              )}
              {mainAssets.map((asset) => (
                <AssetRow key={asset.token.id} asset={asset} price={prices[knownSymbolOf(asset)]} />
              ))}
              {otherAssets.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowOther((open) => !open)}
                  aria-expanded={showOther}
                  className="flex w-full items-center justify-between py-4 text-left text-slate-500 hover:text-slate-700"
                >
                  <span>Other tokens ({otherAssets.length})</span>
                  <span aria-hidden="true">{showOther ? "▴" : "▾"}</span>
                </button>
              )}
              {showOther &&
                otherAssets.map((asset) => (
                  <AssetRow key={asset.token.id} asset={asset} price={prices[knownSymbolOf(asset)]} />
                ))}
            </div>
          </section>
        )}

        {view === "activity" && (
        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold text-slate-900">Recent activity</h2>
          <div className="mt-5 divide-y divide-slate-100">
            {activity.length === 0 && (
              <p className="py-6 text-center text-slate-500">
                No wallet transactions yet.
              </p>
            )}
            {activity.slice(0, 10).map((transaction) => (
              (() => {
                const activityAsset = assets.find(
                  (asset) => asset.token.id === transaction.tokenId
                );
                return (
              <a
                key={transaction.id}
                href={transaction.txHash ? getExplorerTxUrl(transaction.txHash) : undefined}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-4 py-4 hover:bg-slate-50"
              >
                <div>
                  <p className="font-semibold text-slate-900">
                    {transaction.transactionType === "INBOUND"
                      ? "Received"
                      : transaction.operation === "CONTRACT_EXECUTION"
                        ? "Contract interaction"
                        : "Sent"}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    {transaction.createDate
                      ? new Date(transaction.createDate).toLocaleString()
                      : getNetworkConfig().chainName}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-slate-900">
                    {transaction.amounts?.[0] || "—"} {transaction.token?.symbol || activityAsset?.token?.symbol || ""}
                  </p>
                  <p className="mt-1 text-xs font-bold text-blue-600">
                    {transaction.state}
                  </p>
                </div>
              </a>
                );
              })()
            ))}
          </div>
        </section>
        )}

        {view === "send" && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold text-slate-900">Send Token</h2>
            <p className="mt-2 text-slate-600">
              The transfer will execute only after your {walletLabel} approval.
            </p>
            <form onSubmit={handleSend} className="mt-6 space-y-5">
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Asset
                </span>
                <select
                  value={selectedTokenId}
                  onChange={(event) => setSelectedTokenId(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 outline-none focus:border-blue-500"
                >
                  {sendableAssets.map((asset) => (
                    <option key={asset.token.id} value={asset.token.id}>
                      {asset.token.symbol || asset.token.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-slate-700">
                  Recipient address
                </span>
                <input
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="0x..."
                  autoComplete="off"
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500"
                />
              </label>
              <div className="block">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-700">
                    Amount
                  </span>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-500">
                      Balance: {displayedSelectedBalance}{" "}
                      {selectedAsset?.token?.symbol || ""}
                    </span>
                    <button
                      type="button"
                      onClick={useMaximumAmount}
                      disabled={!selectedAsset}
                      className="font-bold text-blue-600 hover:text-blue-700 disabled:text-slate-400"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div className="relative mt-2">
                  <input
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-20 outline-none focus:border-blue-500"
                  />
                  <span className="absolute right-4 top-3 font-semibold text-slate-500">
                    {selectedAsset?.token?.symbol || "TOKEN"}
                  </span>
                </div>
              </div>
              <PrimaryButton
                type="submit"
                disabled={submitting || balanceLoading}
              >
                {submitting ? "Processing transfer…" : "Review & Send"}
              </PrimaryButton>
            </form>
          </section>
        )}
      </main>
    </div>
  );
}
