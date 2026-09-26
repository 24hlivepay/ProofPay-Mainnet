import { getCurrentNetworkId, getNetworkConfig } from "./network";

const ASSETS_BY_NETWORK = {
  // Deployed 2026-09-16. Addresses verified against docs.arc.io and the
  // on-chain usdc()/owner() getters — see MAINNET_TODO.md for tx hashes.
  mainnet: [
    {
      symbol: "USDC",
      name: "USD Coin",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      decimals: 6,
      escrowAddress:
        import.meta.env.VITE_MAINNET_USDC_ESCROW_ADDRESS ||
        "0x626B2731A11B39A782992B57ED102012b607BC79",
      deploymentBlock: 21_188_708,
      isNative: true,
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      tokenAddress: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
      decimals: 6,
      escrowAddress:
        import.meta.env.VITE_MAINNET_EURC_ESCROW_ADDRESS ||
        "0xF6f0178e40dbF82D79e7E90a9b07AB0f32b862C0",
      deploymentBlock: 21_188_797,
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
