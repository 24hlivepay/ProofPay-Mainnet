// Official token and chain logos, served from /public/logos. USDC and EURC are
// the logos Circle publishes and Ethereum, Base, Optimism and Polygon are the
// networks' own logos (both via the Trust Wallet assets repo); Arc, Arbitrum
// and Avalanche come from LI.FI's chain icons. They are local files so the
// history never depends on an outside image host.

const TOKEN_LOGOS = {
  USDC: "/logos/token-usdc.png",
  EURC: "/logos/token-eurc.png",
};

const CHAIN_LOGOS = [
  { match: /^arc\b/i, src: "/logos/chain-arc.svg" },
  { match: /ethereum/i, src: "/logos/chain-ethereum.png" },
  { match: /base/i, src: "/logos/chain-base.png" },
  { match: /arbitrum/i, src: "/logos/chain-arbitrum.svg" },
  { match: /optimism/i, src: "/logos/chain-optimism.png" },
  { match: /polygon/i, src: "/logos/chain-polygon.png" },
  { match: /avalanche/i, src: "/logos/chain-avalanche.svg" },
];

// A grey letter disc for anything without a logo file.
function Fallback({ label }) {
  return (
    <span className="flex h-full w-full items-center justify-center bg-slate-500 text-[0.7em] font-bold text-white">
      {String(label || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function TokenLogo({ symbol }) {
  const src = TOKEN_LOGOS[symbol];
  return src ? <img src={src} alt="" className="h-full w-full object-cover" draggable="false" /> : <Fallback label={symbol} />;
}

export function ChainLogo({ chain }) {
  const entry = CHAIN_LOGOS.find((item) => item.match.test(chain || ""));
  return entry ? <img src={entry.src} alt="" className="h-full w-full object-cover" draggable="false" /> : <Fallback label={chain} />;
}
