import { useNavigate } from "react-router-dom";

export default function Navbar() {
  const navigate = useNavigate();

  return (
    <header className="border-b border-slate-100 bg-white">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex max-w-6xl items-center px-5 py-4 sm:px-6"
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

      </nav>
    </header>
  );
}
