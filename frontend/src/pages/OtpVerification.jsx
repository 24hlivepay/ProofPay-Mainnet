import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import {
  executeCircleChallenge,
  verifyCircleEmailOtp,
} from "../circle/circleConfig";
import api from "../services/api";
import { saveCircleAuthSession } from "../services/wallet";

function findArcWallet(wallets = []) {
  return wallets.find((wallet) => wallet.blockchain === "ARC-TESTNET");
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function OtpVerification() {
  const navigate = useNavigate();
  const email = localStorage.getItem("proofpay-email") || "";
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function loadWallet(userToken) {
    const response = await api.get("/circle/wallets", {
      headers: { "X-User-Token": userToken },
    });
    return findArcWallet(response.data.data?.wallets);
  }

  async function waitForWallet(userToken) {
    const maxAttempts = 20;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const wallet = await loadWallet(userToken);
      if (wallet) return wallet;
      await wait(1500);
    }

    throw new Error(
      "Circle is taking longer than expected to finish your wallet. Please try signing in again."
    );
  }

  function saveWalletSession(wallet, auth) {
    const session = {
      address: wallet.address,
      walletId: wallet.id,
      blockchain: wallet.blockchain,
      walletType: "circle",
      email,
    };

    localStorage.setItem("proofpay-wallet", wallet.address);
    localStorage.setItem("proofpay-wallet-type", "circle");
    localStorage.setItem("proofpay-wallet-session", JSON.stringify(session));
    saveCircleAuthSession(auth);
    sessionStorage.removeItem("proofpay-circle-otp-session");
  }

  async function handleVerify() {
    const otpSession = JSON.parse(
      sessionStorage.getItem("proofpay-circle-otp-session") || "null"
    );

    if (!otpSession?.deviceToken || !otpSession?.deviceEncryptionKey || !otpSession?.otpToken) {
      setError("This verification session has expired. Please request a new code.");
      return;
    }

    try {
      setLoading(true);
      setError("");
      setStatus("Open the secure Circle window and enter the code from your email.");

      const auth = await verifyCircleEmailOtp(otpSession);
      setStatus("Email verified. Loading your Arc Testnet wallet...");

      let wallet = await loadWallet(auth.userToken);

      if (!wallet) {
        setStatus("Creating your user-controlled Arc Testnet wallet...");
        const initializeResponse = await api.post(
          "/circle/initialize-user",
          {},
          { headers: { "X-User-Token": auth.userToken } }
        );
        const challengeId = initializeResponse.data.data?.challengeId;

        if (!challengeId) {
          throw new Error("Circle did not return a wallet creation challenge.");
        }

        await executeCircleChallenge({
          challengeId,
          userToken: auth.userToken,
          encryptionKey: auth.encryptionKey,
        });
        setStatus("Finalizing your Arc Testnet wallet...");
        wallet = await waitForWallet(auth.userToken);
      }

      if (!wallet?.address) {
        throw new Error("Your Arc Testnet wallet was not available after setup.");
      }

      saveWalletSession(wallet, auth);
      setStatus("Wallet ready. Opening ProofPay...");
      navigate("/dashboard");
    } catch (verificationError) {
      setStatus("");
      setError(
        verificationError.response?.data?.message ||
          verificationError.response?.data?.error?.message ||
          verificationError.message ||
          "Circle could not complete wallet setup. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />

      <main className="mx-auto max-w-md px-5 py-12 sm:px-6">
        <div className="rounded-2xl bg-white p-6 shadow sm:p-8">
          <h1 className="text-3xl font-bold text-slate-950">Verify your email</h1>
          <p className="mt-3 text-slate-600">
            Circle sent a one-time code to:
          </p>
          <p className="mt-2 break-all font-semibold text-blue-600">{email}</p>

          <div className="mt-6 rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-800">
            Press the button below, then enter your code in Circle&apos;s secure verification window.
          </div>

          {status && (
            <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm text-green-700">
              {status}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-8">
            <PrimaryButton onClick={handleVerify} disabled={loading}>
              {loading ? "Setting up wallet..." : "Verify code securely"}
            </PrimaryButton>
          </div>

          <button
            type="button"
            onClick={() => navigate("/login")}
            disabled={loading}
            className="mt-4 w-full text-sm font-semibold text-slate-500 hover:text-blue-600 disabled:opacity-50"
          >
            Use a different email
          </button>
        </div>
      </main>
    </div>
  );
}
