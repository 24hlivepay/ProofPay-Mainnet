// Token and chain logos, drawn here as inline SVG (one 32x32 circle each) so
// the history never depends on an outside image host. They follow each brand's
// colour and shape closely enough to be recognised at 20-44px.

const WHITE = "#fff";

function CircleBase({ fill, children }) {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill={fill} />
      {children}
    </svg>
  );
}

// Circle's coin: blue disc, white ring arcs left and right, symbol in the middle.
function Coin({ fill, symbol }) {
  return (
    <CircleBase fill={fill}>
      <path d="M10.6 8.4a9.2 9.2 0 0 0 0 15.2M21.4 8.4a9.2 9.2 0 0 1 0 15.2" fill="none" stroke={WHITE} strokeWidth="1.7" strokeLinecap="round" />
      <text x="16" y="21.2" textAnchor="middle" fontSize="14" fontWeight="700" fill={WHITE} fontFamily="system-ui, -apple-system, Segoe UI, sans-serif">{symbol}</text>
    </CircleBase>
  );
}

const TOKEN_LOGOS = {
  USDC: () => <Coin fill="#2775ca" symbol="$" />,
  EURC: () => <Coin fill="#1c4fd8" symbol="€" />,
  cirBTC: () => <Coin fill="#f7931a" symbol="₿" />,
};

const CHAIN_LOGOS = [
  {
    match: /^arc\b/i,
    render: () => (
      <CircleBase fill="#0f172a">
        <path d="M8.5 21.5a7.5 7.5 0 0 1 15 0" fill="none" stroke={WHITE} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="16" cy="21.5" r="1.9" fill={WHITE} />
      </CircleBase>
    ),
  },
  {
    match: /ethereum/i,
    render: () => (
      <CircleBase fill="#627eea">
        <path d="M16 5.5l-6.2 10.3L16 19.4z" fill={WHITE} fillOpacity=".6" />
        <path d="M16 5.5l6.2 10.3L16 19.4z" fill={WHITE} />
        <path d="M16 20.8l-6.2-3.6L16 26.5z" fill={WHITE} fillOpacity=".6" />
        <path d="M16 20.8l6.2-3.6L16 26.5z" fill={WHITE} />
      </CircleBase>
    ),
  },
  {
    match: /base/i,
    render: () => (
      <CircleBase fill="#0052ff">
        <circle cx="16" cy="16" r="9" fill={WHITE} />
        <rect x="15" y="14.4" width="11" height="3.2" fill="#0052ff" />
      </CircleBase>
    ),
  },
  {
    match: /arbitrum/i,
    render: () => (
      <CircleBase fill="#213147">
        <path d="M10.5 22.5L16 9.5l5.5 13" fill="none" stroke="#28a0f0" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 19.5h6" stroke={WHITE} strokeWidth="2" strokeLinecap="round" />
      </CircleBase>
    ),
  },
  {
    match: /optimism/i,
    render: () => (
      <CircleBase fill="#ff0420">
        <text x="16" y="20.6" textAnchor="middle" fontSize="11.5" fontWeight="800" fill={WHITE} fontFamily="system-ui, -apple-system, Segoe UI, sans-serif">OP</text>
      </CircleBase>
    ),
  },
  {
    match: /polygon/i,
    render: () => (
      <CircleBase fill="#8247e5">
        <path d="M16 7.5l7.4 4.25v8.5L16 24.5l-7.4-4.25v-8.5z" fill="none" stroke={WHITE} strokeWidth="2.6" strokeLinejoin="round" />
      </CircleBase>
    ),
  },
  {
    match: /avalanche/i,
    render: () => (
      <CircleBase fill="#e84142">
        <path d="M16 8l9 15.5H7z" fill={WHITE} />
        <path d="M16 15.2l3.6 6.3h-7.2z" fill="#e84142" />
      </CircleBase>
    ),
  },
];

function Fallback({ label }) {
  return (
    <CircleBase fill="#64748b">
      <text x="16" y="21" textAnchor="middle" fontSize="14" fontWeight="700" fill={WHITE} fontFamily="system-ui, sans-serif">{String(label || "?").slice(0, 1).toUpperCase()}</text>
    </CircleBase>
  );
}

export function TokenLogo({ symbol }) {
  const Logo = TOKEN_LOGOS[symbol];
  return Logo ? <Logo /> : <Fallback label={symbol} />;
}

export function ChainLogo({ chain }) {
  const entry = CHAIN_LOGOS.find((item) => item.match.test(chain || ""));
  return entry ? entry.render() : <Fallback label={chain} />;
}
