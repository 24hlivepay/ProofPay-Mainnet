import { useLocation, useNavigate } from "react-router-dom";

// Global top-nav tabs, rendered once inside Navbar.jsx so they show at the
// same level as the logo on every page -- not just on the four pages they
// link to. Active tab is derived from the current route, not passed in, so
// it stays correct automatically as new routes are added.
const TABS = [
  { key: "escrows", label: "Escrows", to: "/dashboard" },
  { key: "wallet", label: "Wallet", to: "/wallet" },
  { key: "swap-bridge", label: "Swap / Bridge", to: "/swap" },
  { key: "onramp", label: "Onramp Buy", to: "/onramp" },
];

function matchesTab(pathname, tab) {
  if (tab.key === "escrows") return pathname.startsWith("/dashboard");
  return pathname.startsWith(tab.to);
}

export default function DashboardTabs({ className = "flex" }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <div className={`${className} gap-1 overflow-x-auto`}>
      {TABS.map((tab) => {
        const active = matchesTab(pathname, tab);
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => navigate(tab.to)}
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
