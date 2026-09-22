import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentNetworkId, getNetworkConfig, NETWORKS, setCurrentNetworkId } from "../config/network";
import { useClickOutside } from "../hooks/useClickOutside";
import ProofPayLogo from "./ProofPayLogo";

// PR-3: non-blocking auth-expired banner.
// Listens for the "proofpay:auth-expired" event fired by api.js on 401.
// Shows a thin dismissible bar prompting the user to sign in again.
// Does NOT interrupt any action already in flight.
function AuthBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("proofpay:auth-expired", show);
    return () => window.removeEventListener("proofpay:auth-expired", show);
  }, []);

  if (!visible) return null;

  function handleSignIn() {
    setVisible(false);
    // Re-trigger the connect flow — works for both MetaMask and Circle wallets.
    // Home.jsx's connect button does the same thing; dispatching this event
    // lets any page trigger it without coupling to page-specific state.
    window.dispatchEvent(new CustomEvent("proofpay:request-connect"));
  }

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 bg-amber-50 px-4 py-2 text-sm text-amber-800 border-b border-amber-200"
    >
      <span>Session expired — sign in again to continue.</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSignIn}
          className="rounded-md bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-200 transition"
        >
          Sign in
        </button>
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="text-amber-600 hover:text-amber-900 transition"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

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

  // PR-3: JWT is network-bound — always clear on switch so the new network
  // gets a fresh token (the connect flow will issue one for the new chainId).
  localStorage.removeItem("proofpay-jwt");

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
      <AuthBanner />
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
          <ProofPayLogo className="h-10 w-10" />
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
