import { useLocation, useNavigate } from "react-router-dom";
import { getWalletSession } from "../services/wallet";

// Global top-nav tabs, rendered once inside Navbar.jsx so they show at the
// same level as the logo on every page -- not just on the four pages they
// link to. Active tab is derived from the current route, not passed in, so
// it stays correct automatically as new routes are added.
const TABS = [
  { key: "escrows", label: "Escrows", to: "/dashboard" },
  { key: "wallet", label: "Wallet", to: "/wallet" },
  { key: "swap-bridge", label: "Swap / Bridge", to: "/swap" },
  { key: "onramp", label: "Onramp Buy", to: "/onramp" },
  // Docs is its own page: it opens in a separate browser tab.
  { key: "docs", label: "Docs", to: "/docs", newTab: true },
];

// The dispute admin does not buy or sell, so their first tab is "Admin"
// (the dashboard's admin card and the /admin pages) instead of "Escrows".
const ADMIN_TAB = { key: "admin", label: "Admin", to: "/dashboard" };
const ADMIN_WALLET = (import.meta.env.VITE_DISPUTE_ADMIN_WALLET || "").toLowerCase();

function matchesTab(pathname, tab) {
  if (tab.key === "escrows") return pathname.startsWith("/dashboard");
  if (tab.key === "admin") return pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
  if (tab.key === "swap-bridge") return pathname.startsWith("/swap") || pathname.startsWith("/bridge");
  return pathname.startsWith(tab.to);
}

export default function DashboardTabs({ className = "flex" }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const wallet = getWalletSession()?.address?.toLowerCase();
  const isAdmin = Boolean(ADMIN_WALLET) && wallet === ADMIN_WALLET;
  // A signed-out visitor (reading the Docs, or opening a seller link) only
  // gets the Docs tab: every other tab leads to a page that needs a wallet.
  const tabs = !wallet
    ? TABS.filter((tab) => tab.key === "docs")
    : isAdmin ? [ADMIN_TAB, ...TABS.slice(1)] : TABS;

  return (
    <div className={`${className} gap-1 overflow-x-auto`}>
      {tabs.map((tab) => {
        const active = matchesTab(pathname, tab);
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => (tab.newTab ? window.open(`#${tab.to}`, "_blank", "noopener") : navigate(tab.to))}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-bold transition ${
              active
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
