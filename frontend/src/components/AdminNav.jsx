import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/admin/disputes", label: "Disputes" },
  { to: "/admin/escrows", label: "All Escrows" },
  { to: "/admin/audit-log", label: "Audit Log" },
  { to: "/admin/contracts", label: "Contracts" },
];

export default function AdminNav() {
  return (
    <div className="mb-6 flex gap-2 border-b border-slate-200">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
              isActive
                ? "border-blue-600 text-blue-700"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  );
}
