// Single source of truth for which Arc network ProofPay talks to, and the
// per-network values (chain id, RPC, explorer) everything else derives from.
// See ../../../MAINNET_TODO.md for how the mainnet values were verified.
const STORAGE_KEY = "proofpay-network";

export const NETWORKS = {
  mainnet: {
    id: "mainnet",
    chainId: 5042,
    chainHex: "0x13b2",
    chainName: "Arc Mainnet",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorerBase: "https://explorer.arc.io",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    // Circle Wallets API blockchain enum for this network. Not set for
    // mainnet: Circle's docs only document "ARC-TESTNET" as of the 2026-09-16
    // launch, so this is left unconfirmed rather than guessed (see
    // MAINNET_TODO.md step 5). The backend refuses Circle-wallet requests
    // for mainnet the same way, for the same reason.
    circleBlockchain: null,
  },
  testnet: {
    id: "testnet",
    chainId: 5042002,
    chainHex: "0x4cef52",
    chainName: "Arc Testnet",
    rpcUrl: "https://rpc.testnet.arc.network",
    explorerBase: "https://testnet.arcscan.app",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    circleBlockchain: "ARC-TESTNET",
  },
};

const DEFAULT_NETWORK_ID = NETWORKS[import.meta.env.VITE_DEFAULT_NETWORK]
  ? import.meta.env.VITE_DEFAULT_NETWORK
  : "mainnet";

export function getCurrentNetworkId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && NETWORKS[stored]) return stored;
  } catch {
    // localStorage unavailable (private mode, etc.) — fall through to default.
  }

  return DEFAULT_NETWORK_ID;
}

export function setCurrentNetworkId(networkId) {
  if (!NETWORKS[networkId]) {
    throw new Error(`Unknown ProofPay network "${networkId}".`);
  }

  localStorage.setItem(STORAGE_KEY, networkId);
}

export function getNetworkConfig(networkId = getCurrentNetworkId()) {
  return NETWORKS[networkId];
}

export function getExplorerTxUrl(hash, networkId) {
  return `${getNetworkConfig(networkId).explorerBase}/tx/${hash}`;
}

export function getExplorerAddressUrl(address, networkId) {
  return `${getNetworkConfig(networkId).explorerBase}/address/${address}`;
}
