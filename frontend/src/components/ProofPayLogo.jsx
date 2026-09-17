import { getNetworkConfig } from "../config/network";

// Inlined (not an <img src="/proofpay-logo.svg">) so the background square
// can switch green/amber with the network theme — a static SVG file loaded
// via <img> can't be recolored with CSS/classNames.
export default function ProofPayLogo({ className = "h-10 w-10" }) {
  const isMainnet = getNetworkConfig().id === "mainnet";

  return (
    <svg viewBox="0 0 64 64" role="img" aria-label="ProofPay" className={className}>
      <rect width="64" height="64" rx="17" fill={isMainnet ? "#16a34a" : "#d97706"} />
      <path fill="#fff" d="M23 16h11.5C43 16 48 20.6 48 28c0 7.6-5.3 12.2-13.9 12.2h-3.8V49H23V16Zm7.3 6.6v11.1h3.8c4.2 0 6.5-1.9 6.5-5.6 0-3.6-2.3-5.5-6.5-5.5h-3.8Z" />
    </svg>
  );
}
