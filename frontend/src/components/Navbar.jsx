import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentNetworkId, getNetworkConfig, NETWORKS, setCurrentNetworkId } from "../config/network";
import { useClickOutside } from "../hooks/useClickOutside";

function switchToNetwork(nextId) {
  const isCircleWallet = localStorage.getItem("proofpay-wallet-type") === "circle";

  if (isCircleWallet) {
    // Circle wallets are network-specific — the cached session/address is
    // for the network being left. Clearing it here (rather than a full
    // disconnectWallet()) keeps proofpay-email/-circle-auth so the next
    // sign-in only asks for a fresh OTP, not the email again.
    // proofpay-wallet is a second, separate cache of the same address
    // (OtpVerification.jsx sets both; proofpayContract.js's Circle-wallet
    // functions read this one directly) — cleared too so a deep-linked
    // route that skips SessionLanding's redirect can't read the old
    // network's address before a fresh sign-in overwrites it.
    localStorage.removeItem("proofpay-wallet-session");
    localStorage.removeItem("proofpay-wallet");
    localStorage.removeItem("proofpay-last-safe-route");
  }

  setCurrentNetworkId(nextId);
  window.location.reload();
}

export default function Navbar({ walletSlot }) {
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const isMainnet = network.id === "mainnet";
  const [menuOpen, setMenuOpen] = useState(false);
  const currentId = getCurrentNetworkId();
  const menuRef = useClickOutside(menuOpen, () => setMenuOpen(false));

  return (
    <header className="border-b border-slate-100 bg-white">
      <div
        className={`py-1.5 text-center text-xs font-semibold ${
          isMainnet ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
        }`}
      >
        {isMainnet
          ? "Arc Mainnet — live, real funds move here"
          : "Arc Testnet — sandbox, nothing here moves real money"}
      </div>
      <nav
        aria-label="Main navigation"
        className="flex items-center justify-between px-5 py-4 sm:px-6"
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-3 text-left"
        >
          <svg viewBox="0 0 64 64" role="img" aria-label="ProofPay" className="h-10 w-10">
            <rect width="64" height="64" rx="17" fill={isMainnet ? "#16a34a" : "#d97706"} />
            <path fill="#fff" d="M23 16h11.5C43 16 48 20.6 48 28c0 7.6-5.3 12.2-13.9 12.2h-3.8V49H23V16Zm7.3 6.6v11.1h3.8c4.2 0 6.5-1.9 6.5-5.6 0-3.6-2.3-5.5-6.5-5.5h-3.8Z" />
          </svg>
          <span className="text-lg font-bold tracking-tight text-slate-900">
            ProofPay
          </span>
        </button>

        <div className="flex items-center gap-3">
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((isOpen) => !isOpen)}
            title="Switch network"
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              isMainnet
                ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isMainnet ? "bg-green-500" : "bg-amber-500"}`} />
            {network.chainName}
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-10 z-10 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl">
              {Object.values(NETWORKS).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    if (option.id !== currentId) switchToNetwork(option.id);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <span className={`h-2 w-2 rounded-full ${option.id === "mainnet" ? "bg-green-500" : "bg-amber-500"}`} />
                  {option.chainName}
                  {option.id === currentId && <span className="ml-auto text-blue-600">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {walletSlot}
        </div>
      </nav>
    </header>
  );
}
