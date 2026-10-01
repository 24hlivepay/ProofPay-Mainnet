import { useNavigate } from "react-router-dom";

// Shared top-of-page tab bar for Wallet / Swap-Bridge / Escrows / Onramp.
// Wallet is the landing surface (see Hero.jsx and Navbar.jsx), so every
// other real page -- Swap, Onramp, and the Escrows hub (Home.jsx /dashboard)
// -- carries this same bar so none of them become a dead end: whichever tab
// you're not currently on just navigates to that tab's real page directly.
const TABS = [
  { key: "wallet", label: "Wallet", to: "/wallet" },
  { key: "swap-bridge", label: "Swap / Bridge", to: "/swap" },
  { key: "escrows", label: "Escrows", to: "/dashboard" },
  { key: "onramp", label: "Onramp Buy", to: "/onramp" },
];

export default function DashboardTabs({ active }) {
  const navigate = useNavigate();

  return (
    <div className="mb-6 flex gap-2 border-b border-slate-200">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => navigate(tab.to)}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-bold ${
            active === tab.key
              ? "border-green-600 text-green-700"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
