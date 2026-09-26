import { getCurrentNetworkId, getNetworkConfig } from "./network";

const ASSETS_BY_NETWORK = {
  // ProofPayEscrowV2 (no buyer self-refund, two-step owner), deployed on mainnet
  // 2026-09-26 (block 22880209), replacing the v1 mainnet escrows (0x626B...BC79 and
  // 0xF6f0...62C0, which held no funds and are retired). The addresses are fixed here
  // on purpose, with no env override: a stale VITE_MAINNET_* variable must never be able
  // to point the app back at a retired contract. Token addresses verified against
  // docs.arc.io; the contracts were checked on chain (owner, token, no refund()).
  // See CONTRACTS.md for the tx hashes.
  mainnet: [
    {
      symbol: "USDC",
      name: "USD Coin",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      decimals: 6,
      escrowAddress: "0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B",
      deploymentBlock: 22_880_209,
      isNative: true,
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      tokenAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      decimals: 6,
      escrowAddress: "0x7894E539a16b0D1aE272BE4ebF998353C6E15C86",
      deploymentBlock: 22_880_209,
      isNative: false,
    },
    // cirBTC intentionally omitted: Circle has not published a mainnet
    // contract for it (see MAINNET_TODO.md, step 1). Requesting it via
    // getEscrowAsset("cirBTC") on mainnet throws until one exists.
  ],
  // ProofPayEscrowV2 (no buyer self-refund), deployed 2026-09-26. The addresses
  // are fixed here on purpose, with no env override: a stale VITE_ variable must
  // never be able to point the app back at the retired v1 contracts.
  // See CONTRACTS.md for the tx hashes. cirBTC is not offered on testnet: its v1
  // escrow was retired and no V2 cirBTC escrow has been deployed.
  testnet: [
    {
      symbol: "USDC",
      name: "USD Coin",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      decimals: 6,
      escrowAddress: "0xbf28D1d4cb480DDAc52c23670aFECA94D4d719a1",
      deploymentBlock: 64_079_701,
      isNative: true,
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      tokenAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      decimals: 6,
      escrowAddress: "0x7117B300A01C969082DE898F1B1f699F6e8188B3",
      deploymentBlock: 64_079_701,
      isNative: false,
    },
  ],
};

export function getEscrowAssets(networkId = getCurrentNetworkId()) {
  return ASSETS_BY_NETWORK[networkId] || ASSETS_BY_NETWORK.testnet;
}

export function getEscrowAsset(symbol = "USDC", networkId = getCurrentNetworkId()) {
  const asset = getEscrowAssets(networkId).find((entry) => entry.symbol === symbol);

  if (!asset) {
    throw new Error(`${symbol} is not available on ${getNetworkConfig(networkId).chainName}.`);
  }

  return asset;
}
