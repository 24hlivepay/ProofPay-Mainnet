import * as SDK_CHAINS from "@circle-fin/app-kit/chains";

// A CCTP transfer's delivery on the destination chain is sent by Circle's
// relayer, so the wallet never sees it and the bridge result often has no step
// for it. Circle's IRIS service does know it: looking the transfer up by its
// source transaction gives `forwardTxHash`, the destination transaction.
const CHAINS_BY_NAME = Object.fromEntries(
  Object.values(SDK_CHAINS)
    .filter((entry) => entry && typeof entry === "object" && entry.name && entry.cctp?.domain !== undefined)
    .map((entry) => [entry.name, entry])
);

function irisBase(networkId) {
  return networkId === "mainnet" ? "https://iris-api.circle.com" : "https://iris-api-sandbox.circle.com";
}

// Arc's own explorer where we know it (the SDK still carries Arc testnet's old
// explorer domain); the SDK's template for every other chain.
function explorerTxUrl(chainName, hash, network) {
  const chain = CHAINS_BY_NAME[chainName];
  if (!chain) return null;
  if (/^Arc/i.test(chain.chain)) return `${network.explorerBase}/tx/${hash}`;
  return chain.explorerUrl ? chain.explorerUrl.replace("{hash}", hash) : null;
}

/**
 * Looks up the destination transaction of a bridge from its source
 * transaction hash. Resolves to
 *   { state: "found", hash, href }   delivered, hash known
 *   { state: "pending" }             not delivered yet (or not indexed yet)
 *   { state: "none" }                delivered without a relayer hash, or the
 *                                    source chain is unknown to the SDK
 * and rejects only if the lookup itself could not be made.
 */
export async function findDestinationTransaction({ sourceChain, destinationChain, sourceHash, network }) {
  const domain = CHAINS_BY_NAME[sourceChain]?.cctp?.domain;
  if (domain === undefined) return { state: "none" };

  const response = await fetch(`${irisBase(network.id)}/v2/messages/${domain}?transactionHash=${encodeURIComponent(sourceHash)}`);
  if (response.status === 404) return { state: "pending" };
  if (!response.ok) throw new Error(`IRIS answered ${response.status}`);

  const message = (await response.json())?.messages?.[0];
  const hash = message?.forwardTxHash;
  if (/^0x[0-9a-fA-F]{64}$/.test(hash || "")) {
    return { state: "found", hash, href: explorerTxUrl(destinationChain, hash, network) };
  }
  return message?.status === "complete" && message?.forwardState === "COMPLETE" ? { state: "none" } : { state: "pending" };
}
