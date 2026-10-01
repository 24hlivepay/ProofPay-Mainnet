import { useNavigate } from "react-router-dom";

const TABS = [
  { key: "swap", label: "Swap", path: "/swap" },
  { key: "bridge", label: "Bridge", path: "/bridge" },
];

// The Swap | Bridge switch at the top of both pages, so the two read as one
// window with two modes (the layout swap/bridge apps like Jumper use). Each
// mode keeps its own route; `replace` keeps Back going to the dashboard
// instead of bouncing between the two.
export default function SwapBridgeTabs({ active, disabled = false }) {
  const navigate = useNavigate();

  return (
    <div className="flex rounded-2xl bg-slate-100 p-1" role="tablist" aria-label="Swap or bridge">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          disabled={disabled}
          onClick={() => {
            if (active !== tab.key) navigate(tab.path, { replace: true });
          }}
          className={
            active === tab.key
              ? "flex-1 rounded-xl bg-white py-2.5 text-sm font-bold text-slate-900 shadow-sm"
              : "flex-1 rounded-xl py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700"
          }
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
