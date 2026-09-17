import { useNavigate } from "react-router-dom";
import { getCurrentNetworkId, getNetworkConfig, NETWORKS, setCurrentNetworkId } from "../config/network";

function handleNetworkSwitch() {
  const currentId = getCurrentNetworkId();
  const nextId = currentId === "mainnet" ? "testnet" : "mainnet";
  const nextName = NETWORKS[nextId].chainName;
  const isCircleWallet = localStorage.getItem("proofpay-wallet-type") === "circle";
  const reloginNote = isCircleWallet
    ? " Circle issues a separate wallet per network, so you'll need to sign in again for it."
    : "";
  const warning = nextId === "mainnet"
    ? `Switch to ${nextName}? Deposits and payments will use real funds.${reloginNote}`
    : `Switch to ${nextName}? This is a test network — assets there have no real value.${reloginNote}`;

  if (!window.confirm(warning)) return;

  if (isCircleWallet) {
    // Circle wallets are network-specific — the cached session/address is
    // for the network being left. Clearing it here (rather than a full
    // disconnectWallet()) keeps proofpay-email/-circle-auth so the next
    // sign-in only asks for a fresh OTP, not the email again.
    localStorage.removeItem("proofpay-wallet-session");
    localStorage.removeItem("proofpay-last-safe-route");
  }

  setCurrentNetworkId(nextId);
  window.location.reload();
}

export default function Navbar() {
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const isMainnet = network.id === "mainnet";

  return (
    <header className="border-b border-slate-100 bg-white">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-6"
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <img src="/proofpay-logo.svg" alt="" className="h-10 w-10" />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            ProofPay
          </span>
        </button>

        <button
          type="button"
          onClick={handleNetworkSwitch}
          title="Click to switch network"
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
            isMainnet
              ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
              : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${isMainnet ? "bg-green-500" : "bg-amber-500"}`} />
          {network.chainName}
        </button>
      </nav>
    </header>
  );
}
