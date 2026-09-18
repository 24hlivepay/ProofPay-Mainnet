import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  connectWalletWithOptions,
  disconnectWallet,
  getWalletErrorMessage,
  getWalletSession,
} from "../services/wallet";
import api from "../services/api";
import { useClickOutside } from "./useClickOutside";
import { getCurrentNetworkId } from "../config/network";
import CopyButton from "../components/CopyButton";

// The Navbar wallet badge (address + Change/Disconnect menu), shared by
// every page so it isn't only visible on Home.jsx's dashboard. Home.jsx
// keeps its own richer connect handling (buyer/seller counts, inline
// status messages) — this is the lighter version for everywhere else.
export function useWalletBadge() {
  const navigate = useNavigate();
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const isCircleWallet = walletType === "circle";
  const [walletAddress, setWalletAddress] = useState(() => getWalletSession()?.address || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useClickOutside(menuOpen, () => setMenuOpen(false));

  async function connect({ requestAccountSelection = false } = {}) {
    try {
      const walletSession = await connectWalletWithOptions({
        requireSignature: true,
        requestAccountSelection,
      });
      await api.post("/wallet/connect", {
        address: walletSession.address,
        message: walletSession.message,
        signature: walletSession.signature,
        signedAt: walletSession.signedAt,
      });
      setWalletAddress(walletSession.address);
      setMenuOpen(false);
    } catch (error) {
      if (error?.code === 4001 || /rejected|denied/i.test(error?.message || "")) return;
      window.alert(getWalletErrorMessage(error));
    }
  }

  function handleClick() {
    if (walletAddress) {
      setMenuOpen((isOpen) => !isOpen);
      return;
    }

    // A Circle wallet with no active session (e.g. after switching Arc
    // networks) needs a fresh email/OTP sign-in, not the MetaMask/Rabby
    // flow connect() otherwise triggers.
    if (isCircleWallet) {
      navigate("/login");
      return;
    }

    connect();
  }

  async function handleDisconnect() {
    await disconnectWallet();
    setWalletAddress("");
    setMenuOpen(false);
    navigate("/", { replace: true });
  }

  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const isMainnet = getCurrentNetworkId() === "mainnet";

  const walletSlot = (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={handleClick}
        className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
          isMainnet
            ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
      >
        {shortWallet ? `Wallet: ${shortWallet}` : "Connect Wallet"}
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-10 z-10 w-full overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <span className="font-mono text-xs text-slate-700">{shortWallet}</span>
            <CopyButton value={walletAddress} />
          </div>
          <button
            onClick={() => {
              setMenuOpen(false);
              navigate("/profile");
            }}
            className="w-full whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Profile
          </button>
          <button
            onClick={() => (isCircleWallet ? navigate("/login") : connect({ requestAccountSelection: true }))}
            className="w-full whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Change Wallet
          </button>
          <button onClick={handleDisconnect} className="w-full whitespace-nowrap px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50">
            Disconnect
          </button>
        </div>
      )}
    </div>
  );

  return { walletSlot, walletAddress };
}
