export const ESCROW_ASSETS = [
  {
    symbol: "USDC",
    name: "USD Coin",
    tokenAddress: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    escrowAddress: "0xCd0f43E573899809ff96C560439570A760698C9a",
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
    isNative: false,
  },
];

export function getEscrowAsset(symbol = "USDC") {
  return (
    ESCROW_ASSETS.find((asset) => asset.symbol === symbol) ||
    ESCROW_ASSETS[0]
  );
}
