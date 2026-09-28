import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppKit } from "@circle-fin/app-kit";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { connectWalletWithOptions } from "../services/wallet";
import { API_BASE_URL } from "../services/api";
import { getCurrentNetworkId, getNetworkConfig } from "../config/network";

// Buy USDC/EURC on Arc with a card, Apple Pay, Google Pay, or bank transfer,
// delivered straight to the connected wallet. Circle's own hosted widget
// (App Kit SDK) handles KYC, payment, and settlement -- ProofPay only mints
// the short-lived session server-side (see POST /api/onramp/sessions) and
// mounts the iframe. Card/Apple Pay/Google Pay additionally need this site's
// domain registered against the account's KYB in the Circle Console; until
// then those methods 403 inside the widget while bank transfer still works.
//
// Circle's Onramp sandbox and production are separate environments with
// different widget origins; the client's widgetBaseUrl must exactly match
// whatever the server passed to createAppServerKit() (see server.js'
// ONRAMP_ENV_BY_NETWORK) or mountIframe throws a WIDGET_URL_ORIGIN_MISMATCH
// error. Arc Testnet -> Circle sandbox, Arc Mainnet -> Circle production
// (the SDK's own default, no override). Read once at module load: switching
// ProofPay's network reloads the page (see Navbar.jsx), so this is never
// stale for the page it's actually rendering.
const kit = new AppKit(
  getCurrentNetworkId() === "testnet"
    ? { onramp: { widgetBaseUrl: "https://onramp-sandbox.arc.io" } }
    : undefined
);

export default function Onramp() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const containerRef = useRef(null);
  const widgetRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | connecting | loading | ready | submitted | settled | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    return () => {
      widgetRef.current?.close();
      widgetRef.current = null;
    };
  }, []);

  async function start() {
    if (!walletAddress) return;
    widgetRef.current?.close();
    setStatus("connecting");
    setMessage("");

    try {
      // The widget's own fetch does not go through services/api.js, so it
      // never gets that client's automatic 401-retry -- make sure a fresh
      // session exists before reading the token into the request headers.
      await connectWalletWithOptions({ requireSignature: true });
      const token = localStorage.getItem("proofpay-jwt");
      if (!token) throw new Error("Please connect your wallet and try again.");

      setStatus("loading");
      const session = await kit.onramp.fetchSession({
        url: `${API_BASE_URL}/onramp/sessions`,
        headers: { Authorization: `Bearer ${token}` },
        body: {
          appUserId: walletAddress.toLowerCase(),
          destinationAddress: walletAddress,
          assets: {
            tokens: ["USDC", "EURC"],
            chains: [network.id === "mainnet" ? "Arc" : "Arc_Testnet"],
          },
        },
      });

      widgetRef.current = kit.onramp.mountIframe({
        session,
        container: containerRef.current,
        onInitializationSuccess: () => setStatus("ready"),
        onInitializationError: (envelope) => {
          setStatus("error");
          setMessage(
            envelope.payload?.code === "INVALID_SESSION_TOKEN"
              ? "This session expired before it loaded. Try again."
              : "The onramp widget could not start. Try again in a moment."
          );
        },
        onDepositSubmitted: () => setStatus("submitted"),
        onDepositSettled: () => {
          setStatus("settled");
          setMessage(`Your ${network.chainName} balance updates in a few minutes.`);
        },
        onDepositNotCompleted: () => {
          setStatus("ready");
          setMessage("That attempt didn't go through. You can try again below.");
        },
        onSessionExpired: () => start(),
      });
    } catch (startError) {
      setStatus("error");
      setMessage(
        startError.response?.data?.message ||
        startError.message ||
        "Unable to start the onramp widget."
      );
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-2xl px-5 py-8 sm:px-6">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-3xl font-bold text-slate-900">Buy USDC / EURC</h1>
          <p className="mt-2 text-slate-600">
            Fund your {network.chainName} wallet with a card, Apple Pay, Google Pay, or bank
            transfer. Handled entirely by Circle — ProofPay never sees your payment details.
          </p>

          {!walletAddress ? (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">
              Connect your wallet first, then come back to this page.
            </p>
          ) : (
            <>
              {status === "idle" && (
                <div className="mt-6">
                  <PrimaryButton onClick={start}>Continue to buy</PrimaryButton>
                </div>
              )}

              {(status === "connecting" || status === "loading") && (
                <p className="mt-6 text-slate-600">
                  {status === "connecting" ? "Confirming your wallet..." : "Loading the onramp widget..."}
                </p>
              )}

              {status === "error" && (
                <div className="mt-6">
                  <p className="rounded-xl bg-red-50 p-4 text-red-700">{message}</p>
                  <div className="mt-4">
                    <PrimaryButton onClick={start}>Try again</PrimaryButton>
                  </div>
                </div>
              )}

              {status === "settled" && (
                <div className="mt-6">
                  <p className="rounded-xl bg-green-50 p-4 text-green-800">✓ Purchase submitted. {message}</p>
                  <div className="mt-4">
                    <PrimaryButton onClick={() => navigate("/dashboard")}>Back to Dashboard</PrimaryButton>
                  </div>
                </div>
              )}

              {status === "submitted" && (
                <p className="mt-6 rounded-xl bg-blue-50 p-4 text-blue-800">
                  Payment submitted — waiting for it to settle on-chain...
                </p>
              )}

              {message && status === "ready" && (
                <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-800">{message}</p>
              )}

              <div
                ref={containerRef}
                className={status === "loading" || status === "ready" || status === "submitted" ? "mt-6 w-full" : "hidden"}
                style={{ height: "720px" }}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
