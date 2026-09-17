import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import {
  connectWalletWithOptions,
  disconnectWallet,
  getWalletErrorMessage,
  getWalletSession,
} from "../services/wallet";
import { getLiveContractStats } from "../services/proofpayContract";
import api from "../services/api";
import { getCurrentNetworkId, getNetworkConfig } from "../config/network";
import { useClickOutside } from "../hooks/useClickOutside";

const EMPTY_COUNTS = { pending: 0, active: 0, completed: 0, cancelled: 0, disputes: 0 };
const EMPTY_STATS = {
  lockedByAsset: { USDC: 0, EURC: 0, cirBTC: 0 },
  executedEscrows: 0,
};
const CONTRACT_STATS_TIMEOUT_MS = 3500;
const CIRCLE_FAUCET_URL = "https://faucet.circle.com/?allow=true";

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Contract statistics timed out")), timeoutMs);
    }),
  ]);
}

export default function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const isCircleWallet = walletType === "circle";
  const [walletAddress, setWalletAddress] = useState(() => getWalletSession()?.address || "");
  const [walletError, setWalletError] = useState("");
  const [walletStatus, setWalletStatus] = useState("");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useClickOutside(walletMenuOpen, () => setWalletMenuOpen(false));
  const [buyerCounts, setBuyerCounts] = useState(EMPTY_COUNTS);
  const [sellerCounts, setSellerCounts] = useState(EMPTY_COUNTS);
  const [networkStats, setNetworkStats] = useState(null);
  const [networkStatsError, setNetworkStatsError] = useState("");

  useEffect(() => {
    if (isCircleWallet) return undefined;

    const injected = window.ethereum;
    const provider = walletType === "rabby"
      ? (injected?.providers || []).find((item) => item?.isRabby) ||
        (injected?.isRabby ? injected : null)
      : injected;

    if (!provider?.on) return undefined;

    const handleAccountsChanged = (accounts = []) => {
      const nextAddress = accounts[0] || "";
      if (!nextAddress) {
        setWalletAddress("");
        setWalletStatus("Wallet disconnected. Connect again to continue.");
        return;
      }

      if (nextAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        setWalletStatus("Wallet account changed. Sign the ProofPay message to continue.");
        handleConnectWallet();
      }
    };

    provider.on("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [isCircleWallet, walletAddress, walletType]);

  useEffect(() => {
    let mounted = true;

    async function loadCounts() {
      if (!walletAddress) {
        if (mounted) {
          setBuyerCounts(EMPTY_COUNTS);
          setSellerCounts(EMPTY_COUNTS);
        }
        return;
      }

      try {
        const categories = ["pending", "active", "completed", "cancelled", "disputes"];
        const requestCounts = async (role) => {
          const responses = await Promise.all(categories.map((category) => api.get("/escrows", {
            params: { category, wallet: walletAddress, role },
          })));

          return {
            counts: Object.fromEntries(
              categories.map((category, index) => [category, responses[index].data.escrows.length])
            ),
          };
        };

        const [nextBuyer, nextSeller] = await Promise.all([
          requestCounts("buyer"),
          requestCounts("seller"),
        ]);

        if (mounted) {
          setBuyerCounts(nextBuyer.counts);
          setSellerCounts(nextSeller.counts);

        }
      } catch {
        // The dashboard remains usable even if the local backend is restarting.
      }
    }

    loadCounts();
    return () => { mounted = false; };
  }, [walletAddress]);

  useEffect(() => {
    let mounted = true;

    async function loadNetworkStats() {
      try {
        const [contractStats, databaseResponse] = await Promise.all([
          withTimeout(getLiveContractStats(), CONTRACT_STATS_TIMEOUT_MS)
            .catch(() => ({})),
          api.get("/escrow-stats"),
        ]);
        const databaseStats = databaseResponse.data;

        if (mounted) {
          setNetworkStats({
            ...EMPTY_STATS,
            ...Object.fromEntries(
              Object.entries(contractStats).filter(([, value]) => value !== null && value !== undefined)
            ),
            // Database records provide the total count. Each token contract
            // remains the source of truth for its currently locked balance.
            executedEscrows: databaseStats.executedEscrows ?? 0,
            lockedByAsset: contractStats.lockedByAsset ?? databaseStats.lockedByAsset ?? EMPTY_STATS.lockedByAsset,
          });
          setNetworkStatsError("");
        }
      } catch {
        try {
          const response = await api.get("/escrow-stats");
          if (mounted) {
            setNetworkStats({ ...EMPTY_STATS, ...response.data });
            setNetworkStatsError("Contract history is temporarily unavailable; showing saved ProofPay records.");
          }
        } catch {
          if (mounted) {
            setNetworkStats(EMPTY_STATS);
            setNetworkStatsError("Live statistics are temporarily unavailable.");
          }
        }
      }
    }

    loadNetworkStats();
    const interval = setInterval(loadNetworkStats, 30_000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  async function handleConnectWallet({ requestAccountSelection = false } = {}) {
    const hadConnectedWallet = Boolean(walletAddress);

    try {
      setWalletError("");
      const walletSession = await connectWalletWithOptions({
        requireSignature: true,
        requestAccountSelection,
        onStatus: setWalletStatus,
      });
      await api.post("/wallet/connect", {
        address: walletSession.address,
        message: walletSession.message,
        signature: walletSession.signature,
        signedAt: walletSession.signedAt,
      });
      setWalletAddress(walletSession.address);
      setWalletStatus(`Wallet connected to ${getNetworkConfig().chainName}.`);
      setWalletMenuOpen(false);
    } catch (error) {
      const message = getWalletErrorMessage(error);
      setWalletStatus("");

      if (error?.code === 4001 || /rejected|denied/i.test(error?.message || "")) {
        setWalletError("");
        setWalletStatus(
          hadConnectedWallet
            ? "Wallet change cancelled. Your current wallet is still connected."
            : "Wallet connection cancelled. You can connect whenever you are ready."
        );
        return;
      }

      setWalletError(message);
    }
  }

  function handleWalletButton() {
    if (walletAddress) {
      setWalletMenuOpen((isOpen) => !isOpen);
      return;
    }

    // A Circle wallet with no active session (e.g. after switching Arc
    // networks, which signs the user out of the network-specific Circle
    // wallet) needs a fresh email/OTP sign-in, not the MetaMask/Rabby
    // flow this button otherwise triggers.
    if (isCircleWallet) {
      navigate("/login");
      return;
    }

    handleConnectWallet();
  }

  async function handleDisconnectWallet() {
    await disconnectWallet();
    setWalletAddress("");
    setWalletError("");
    setWalletStatus("");
    setWalletMenuOpen(false);
    navigate("/", { replace: true });
  }

  const shortWallet = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : null;

  const disputeAdminWallet = import.meta.env.VITE_DISPUTE_ADMIN_WALLET || "";
  const isDisputeAdmin = Boolean(disputeAdminWallet)
    && walletAddress?.toLowerCase() === disputeAdminWallet.toLowerCase();

  const openOrders = (path, role) => navigate(path, { state: { role } });
  const mode = location.pathname === "/dashboard/buying"
    ? "buyer"
    : location.pathname === "/dashboard/selling"
      ? "seller"
      : "";

  const walletSlot = (
    <div className="relative" ref={walletMenuRef}>
      <button
        type="button"
        onClick={handleWalletButton}
        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
      >
        {shortWallet ? `Wallet: ${shortWallet}` : "Connect Wallet"}
      </button>

      {walletMenuOpen && (
        <div className="absolute right-0 top-10 z-10 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-xl">
          <button
            onClick={() => (
              isCircleWallet
                ? navigate("/login")
                : handleConnectWallet({ requestAccountSelection: true })
            )}
            className="w-full px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Change Wallet
          </button>
          <button onClick={handleDisconnectWallet} className="w-full px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50">
            Disconnect Wallet
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />

      <main className="mx-auto max-w-5xl px-5 py-7 sm:px-6">
        <div className="mb-7">
          <h1 className="text-3xl font-bold text-slate-900">{mode === "buyer" ? "Buying Escrows" : mode === "seller" ? "Selling Escrows" : "Choose Your Workspace"}</h1>
          <p className="mt-2 text-slate-600">{mode ? "Manage your escrow records in this workspace." : "Choose whether you want to buy or sell with this wallet."}</p>

          {walletError && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{walletError}</p>}
          {walletStatus && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-700">{walletStatus}</p>}
        </div>

        {!mode && (
          <LiveEscrowOverview
            stats={networkStats}
            statsError={networkStatsError}
            onFaucetClick={() => window.open(CIRCLE_FAUCET_URL, "_blank", "noopener,noreferrer")}
          />
        )}

        {!mode && (
          <section className={`mx-auto mt-7 grid max-w-5xl gap-4 ${isDisputeAdmin ? "md:grid-cols-2" : "md:grid-cols-3"}`}>
            <WorkspaceCard icon="💳" title="My Wallet" description={`View balances, receive, and send supported ${getNetworkConfig().chainName} tokens.`} onClick={() => navigate("/wallet")} />
            {isDisputeAdmin ? (
              <WorkspaceCard icon="🛡️" title="Admin Disputes" description="Review evidence from both sides and settle disputed escrows on-chain." onClick={() => navigate("/admin/disputes")} />
            ) : (
              <>
                <WorkspaceCard icon="🛒" title="Buying Escrows" description="Create a secure escrow, deposit a supported asset, and release payment after delivery." onClick={() => navigate("/dashboard/buying")} />
                <WorkspaceCard icon="🏪" title="Selling Escrows" description="See accepted sales, confirm delivery, and track payments received." onClick={() => navigate("/dashboard/selling")} />
              </>
            )}
          </section>
        )}

        {mode === "buyer" && (
          <>
            <BackToWorkspaces onClick={() => navigate("/dashboard")} />
            <DashboardSection>
          <RoleCard icon="➕" title="Create Escrow" description="Start a secure purchase." tone="blue" onClick={() => navigate("/create")} />
          <RoleCard icon="🟠" title="Pending Orders" description="Waiting for seller acceptance or your deposit." count={buyerCounts.pending} tone="orange" onClick={() => openOrders("/pending-orders", "buyer")} />
          <RoleCard icon="🟡" title="Active Purchases" description="Funds locked or delivery in progress." count={buyerCounts.active} tone="yellow" onClick={() => openOrders("/active-orders", "buyer")} />
          <RoleCard icon="🟢" title="Completed Purchases" description="Payments you released to sellers." count={buyerCounts.completed} tone="green" onClick={() => openOrders("/completed-orders", "buyer")} />
          <RoleCard icon="🔴" title="Cancelled Purchases" description="Cancelled, rejected, or expired requests." count={buyerCounts.cancelled} tone="red" onClick={() => openOrders("/cancelled-orders", "buyer")} />
          <RoleCard icon="⚖️" title="My Disputes" description="Disputes on your purchases, open or resolved." count={buyerCounts.disputes} tone="red" onClick={() => openOrders("/disputes", "buyer")} />
            </DashboardSection>
          </>
        )}

        {mode === "seller" && (
          <>
            <BackToWorkspaces onClick={() => navigate("/dashboard")} />
            <DashboardSection title="Selling" description="Escrows where you are receiving payment.">
          <RoleCard icon="⏳" title="Pending Sales" description="Accepted deals waiting for the buyer to deposit." count={sellerCounts.pending} tone="orange" onClick={() => openOrders("/pending-orders", "seller")} />
          <RoleCard icon="📦" title="Active Sales" description="Funds locked — confirm delivery when ready." count={sellerCounts.active} tone="yellow" onClick={() => openOrders("/active-orders", "seller")} />
          <RoleCard icon="✅" title="Payments Received" description="Completed sales paid to your wallet." count={sellerCounts.completed} tone="green" onClick={() => openOrders("/completed-orders", "seller")} />
          <RoleCard icon="🔴" title="Cancelled Sales" description="Rejected or expired sales requests." count={sellerCounts.cancelled} tone="red" onClick={() => openOrders("/cancelled-orders", "seller")} />
          <RoleCard icon="⚖️" title="My Disputes" description="Disputes on your sales, open or resolved." count={sellerCounts.disputes} tone="red" onClick={() => openOrders("/disputes", "seller")} />
            </DashboardSection>
          </>
        )}
      </main>
    </div>
  );
}

function LiveEscrowOverview({
  stats,
  statsError,
  onFaucetClick,
}) {
  const hasStats = Boolean(stats);
  const formatLockedAmount = (symbol) => Number(
    stats?.lockedByAsset?.[symbol] || 0
  ).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: symbol === "cirBTC" ? 8 : 6,
  });

  const isTestnetHero = getCurrentNetworkId() === "testnet";
  const heroGradient = isTestnetHero
    ? "bg-gradient-to-br from-amber-600 via-amber-500 to-orange-600"
    : "bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700";

  return (
    <section className={`overflow-hidden rounded-2xl ${heroGradient} p-5 text-white shadow-lg sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className={`text-sm font-bold uppercase tracking-[0.18em] ${isTestnetHero ? "text-amber-100" : "text-blue-200"}`}>Live ProofPay Network</p>
          <h2 className="mt-2 text-xl font-bold sm:text-2xl">Protected by smart-contract escrow</h2>
          <p className={`mt-2 max-w-2xl text-sm sm:text-base ${isTestnetHero ? "text-amber-100" : "text-blue-100"}`}>Live values read directly from the deployed {getNetworkConfig().chainName} escrow contract.</p>
        </div>
        {getCurrentNetworkId() === "testnet" && (
          <button onClick={onFaucetClick} className="h-12 w-56 rounded-xl bg-white px-4 text-center text-[17px] font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50">
            Faucet
          </button>
        )}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="USDC Locked" value={hasStats ? `${formatLockedAmount("USDC")} USDC` : "Loading…"} />
        <StatCard label="EURC Locked" value={hasStats ? `${formatLockedAmount("EURC")} EURC` : "Loading…"} />
        {getCurrentNetworkId() === "testnet" && (
          <StatCard label="cirBTC Locked" value={hasStats ? `${formatLockedAmount("cirBTC")} cirBTC` : "Loading…"} />
        )}
        <StatCard label="Executed Escrows" value={hasStats ? stats.executedEscrows ?? "Checking…" : "Loading…"} />
      </div>
      {statsError && <p className={`mt-5 text-sm font-medium ${isTestnetHero ? "text-amber-100" : "text-blue-100"}`}>{statsError}</p>}
    </section>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border border-white/20 bg-white/10 p-4 text-white">
      <p className={`text-sm font-medium ${getCurrentNetworkId() === "testnet" ? "text-amber-100" : "text-blue-100"}`}>{label}</p>
      <p className="mt-1.5 text-xl font-bold">{value}</p>
    </div>
  );
}

function BackToWorkspaces({ onClick }) {
  return <button onClick={onClick} className="mt-8 font-semibold text-blue-600 hover:text-blue-700">← Back to Buying & Selling</button>;
}

function WorkspaceCard({ icon, title, description, onClick }) {
  return (
    <button onClick={onClick} className="rounded-2xl border border-blue-200 bg-white p-5 text-center shadow-sm transition hover:-translate-y-1 hover:border-blue-400 hover:shadow-lg">
      <div className="text-3xl">{icon}</div>
      <h2 className="mt-3 text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
      <span className="mt-4 inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Open {title}</span>
    </button>
  );
}

function DashboardSection({ children }) {
  return (
    <section className="mt-8">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

function RoleCard({ icon, title, description, count, tone, onClick }) {
  const tones = {
    blue: "bg-blue-600 text-white hover:bg-blue-700",
    orange: "border-orange-200 bg-white hover:border-orange-300",
    yellow: "border-yellow-200 bg-white hover:border-yellow-300",
    green: "border-green-200 bg-white hover:border-green-300",
    red: "border-red-200 bg-white hover:border-red-300",
  };
  const countColors = {
    orange: "bg-orange-100 text-orange-700",
    yellow: "bg-yellow-100 text-yellow-700",
    green: "bg-green-100 text-green-700",
    red: "bg-red-100 text-red-700",
  };
  const isPrimary = tone === "blue";

  return (
    <button onClick={onClick} className={`rounded-2xl border p-5 text-left shadow-sm transition hover:shadow-md ${tones[tone]}`}>
      <div className="text-3xl">{icon}</div>
      <h3 className="mt-3 text-xl font-bold">{title}</h3>
      <p className={`mt-1.5 text-sm ${isPrimary ? "text-blue-100" : "text-slate-600"}`}>{description}</p>
      {typeof count === "number" && (
        <div className={`mt-4 inline-flex rounded-full px-3 py-1.5 text-sm font-bold ${countColors[tone]}`}>
          {count} {count === 1 ? "Order" : "Orders"}
        </div>
      )}
    </button>
  );
}
