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
  testnet: [
    {
      symbol: "USDC",
      name: "USD Coin",
      tokenAddress: "0x3600000000000000000000000000000000000000",
      decimals: 6,
      escrowAddress: "0xCd0f43E573899809ff96C560439570A760698C9a",
      deploymentBlock: 53_590_676,
      isNative: true,
    },
    {
      symbol: "EURC",
      name: "Euro Coin",
      tokenAddress: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
      decimals: 6,
      escrowAddress:
        import.meta.env.VITE_EURC_ESCROW_ADDRESS ||
        "0xa4322D8ba3E040A3028FD6ABaC3c6a5625ed4ca7",
      deploymentBlock: 53_590_676,
      isNative: false,
    },
    {
      symbol: "cirBTC",
      name: "Circle Wrapped Bitcoin",
      tokenAddress: "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF",
      decimals: 8,
      escrowAddress:
        import.meta.env.VITE_CIRBTC_ESCROW_ADDRESS ||
        "0x8bfeD6F70Eb595946543b192b6E63d75A0bBEf4B",
      deploymentBlock: 53_590_676,
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
