import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { connectWalletWithOptions, getWalletErrorMessage } from "../../services/wallet";
import api from "../../services/api";

export default function Hero() {
  const navigate = useNavigate();
  const [connecting, setConnecting] = useState(false);
  const [walletStatus, setWalletStatus] = useState("");
  const [walletError, setWalletError] = useState("");
  const [showWalletChoices, setShowWalletChoices] = useState(false);

  async function handleWalletConnection(walletType) {
    try {
      setConnecting(true);
      setWalletError("");
      const walletSession = await connectWalletWithOptions({
        requireSignature: true,
        walletType,
        onStatus: setWalletStatus,
      });

      await api.post("/wallet/connect", {
        address: walletSession.address,
        message: walletSession.message,
        signature: walletSession.signature,
        signedAt: walletSession.signedAt,
      });
      setWalletStatus("Wallet connected to Arc Testnet. Opening your dashboard...");
      setShowWalletChoices(false);
      navigate("/dashboard");
    } catch (error) {
      setWalletStatus("");
      setWalletError(getWalletErrorMessage(error));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <section className="flex min-h-screen items-center justify-center px-6 py-20">
      <div className="mx-auto flex w-full max-w-4xl flex-col items-center text-center">
        <img src="/proofpay-logo.svg" alt="ProofPay logo" className="mb-6 h-16 w-16 shadow-lg shadow-blue-200" />

        <p className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          ProofPay
        </p>

        <h1 className="mt-8 max-w-3xl text-5xl font-extrabold leading-[1.08] tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
          Secure P2P
          <span className="block text-blue-600">Crypto Escrow</span>
        </h1>

        <div className="mt-10 flex w-full max-w-xs flex-col gap-4">
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="w-full rounded-xl bg-blue-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            Continue with Email
          </button>

          <button
            type="button"
            onClick={() => setShowWalletChoices((visible) => !visible)}
            disabled={connecting}
            className="w-full rounded-xl bg-blue-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {connecting ? "Connecting..." : "Connect with Wallet"}
          </button>

          <a
            href="https://youtu.be/O791txQRc5E"
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white px-8 py-4 text-base font-semibold text-blue-700 shadow-sm transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <span aria-hidden="true">▶</span>
            Watch ProofPay Demo
          </a>
        </div>

        {walletStatus && <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-sm font-medium text-blue-700">{walletStatus}</p>}
        {walletError && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{walletError}</p>}

        <p className="mt-5 text-sm text-slate-400">
          Choose the option that is easiest for you.
        </p>
      </div>

      {showWalletChoices && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 px-5 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !connecting) {
              setShowWalletChoices(false);
            }
          }}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white p-6 text-left shadow-2xl sm:p-8"
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-dialog-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="wallet-dialog-title" className="text-2xl font-bold text-slate-950">
                  Connect a wallet
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Choose a wallet that supports Arc Testnet.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close wallet selection"
                onClick={() => setShowWalletChoices(false)}
                disabled={connecting}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                ×
              </button>
            </div>

            <div className="mt-7 space-y-3">
              <WalletOption
                name="MetaMask"
                description="Connect using the MetaMask browser extension."
                symbol="M"
                disabled={connecting}
                onClick={() => handleWalletConnection("metamask")}
              />
              <WalletOption
                name="Rabby Wallet"
                description="Connect using the Rabby browser extension."
                symbol="R"
                disabled={connecting}
                onClick={() => handleWalletConnection("rabby")}
              />
            </div>

            {connecting && (
              <p className="mt-5 rounded-xl bg-blue-50 px-4 py-3 text-center text-sm font-medium text-blue-700">
                {walletStatus || "Opening your wallet..."}
              </p>
            )}
            {walletError && !connecting && (
              <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-center text-sm font-medium text-red-700">
                {walletError}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function WalletOption({ name, description, symbol, disabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-4 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-blue-500 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
        {symbol}
      </span>
      <span>
        <span className="block font-bold text-slate-900">{name}</span>
        <span className="mt-1 block text-sm text-slate-500">{description}</span>
      </span>
      <span className="ml-auto text-xl text-slate-400">›</span>
    </button>
  );
}
