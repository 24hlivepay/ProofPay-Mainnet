import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useWalletBadge } from "../hooks/useWalletBadge";
import PrimaryButton from "../components/PrimaryButton";
import InputField from "../components/InputField";
import api from "../services/api";
import { connectWalletWithOptions } from "../services/wallet";

// Three-factor admin gate: wallet (proves control of the admin address) ->
// password -> emailed one-time code. Each step calls the backend directly
// so the lockouts/expiry live server-side, not just in this component's
// state. On full success the short-lived admin JWT is stored in
// sessionStorage (not localStorage) so it clears when the tab closes and
// never mixes with the regular buyer/seller session.
export default function AdminLogin() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = location.state?.redirectTo || "/admin/disputes";

  const [step, setStep] = useState("wallet"); // wallet | password | otp
  const [connecting, setConnecting] = useState(false);
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [otpSent, setOtpSent] = useState(false);

  async function handleConnect() {
    try {
      setConnecting(true);
      setError("");
      await connectWalletWithOptions({ requireSignature: true });
      // connectWalletWithOptions can resolve without actually storing a
      // session JWT (e.g. a Circle wallet's own /wallet/connect call fails
      // for a reason its own catch block doesn't treat as fatal). Check
      // here instead of silently advancing to a step that will then fail
      // with a confusing "no token" error.
      if (!localStorage.getItem("proofpay-jwt")) {
        setError("Wallet connected, but sign-in did not complete. Please try connecting again.");
        return;
      }
      setStep("password");
    } catch (connectError) {
      if (connectError?.code === 4001) return;
      setError(connectError.message || "Unable to connect wallet.");
    } finally {
      setConnecting(false);
    }
  }

  async function submitPassword() {
    try {
      setSubmitting(true);
      setError("");
      await api.post("/admin/verify-password", { password });
      setPassword("");
      setStep("otp");
      await sendOtp();
    } catch (verifyError) {
      setError(verifyError.response?.data?.message || "Unable to verify password.");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendOtp() {
    try {
      setError("");
      await api.post("/admin/send-otp");
      setOtpSent(true);
    } catch (sendError) {
      setError(sendError.response?.data?.message || "Unable to send the code.");
    }
  }

  async function submitOtp() {
    try {
      setSubmitting(true);
      setError("");
      const response = await api.post("/admin/verify-otp", { otp });
      sessionStorage.setItem("proofpay-admin-jwt", response.data.token);
      navigate(redirectTo, { replace: true });
    } catch (verifyError) {
      setError(verifyError.response?.data?.message || "Unable to verify the code.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-md px-5 py-10 sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-bold text-slate-900">Admin sign-in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Three steps: connect the admin wallet, enter the admin password, then confirm the
            emailed code.
          </p>

          <div className="mt-6 flex items-center gap-2 text-xs font-semibold">
            <Step label="Wallet" active={step === "wallet"} done={step !== "wallet"} />
            <Divider />
            <Step label="Password" active={step === "password"} done={step === "otp"} />
            <Divider />
            <Step label="Email code" active={step === "otp"} done={false} />
          </div>

          {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          {step === "wallet" && (
            <div className="mt-6">
              <p className="text-sm text-slate-600">
                {walletAddress
                  ? `Connected: ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. Sign to continue.`
                  : "Connect the wallet configured as the ProofPay admin."}
              </p>
              <div className="mt-4">
                <PrimaryButton onClick={handleConnect} disabled={connecting}>
                  {connecting ? "Connecting..." : "Connect admin wallet"}
                </PrimaryButton>
              </div>
            </div>
          )}

          {step === "password" && (
            <div className="mt-6">
              <label className="block text-sm font-semibold text-slate-700">
                Admin password
                <div className="mt-2">
                  <InputField
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter the admin password"
                  />
                </div>
              </label>
              <div className="mt-4">
                <PrimaryButton onClick={submitPassword} disabled={submitting || !password}>
                  {submitting ? "Checking..." : "Continue"}
                </PrimaryButton>
              </div>
            </div>
          )}

          {step === "otp" && (
            <div className="mt-6">
              <p className="text-sm text-slate-600">
                {otpSent
                  ? "A 6-digit code was emailed to the admin address. It expires in 5 minutes."
                  : "Sending a code..."}
              </p>
              <label className="mt-4 block text-sm font-semibold text-slate-700">
                Verification code
                <div className="mt-2 font-mono tracking-widest">
                  <InputField
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                  />
                </div>
              </label>
              <div className="mt-4">
                <PrimaryButton onClick={submitOtp} disabled={submitting || otp.length !== 6}>
                  {submitting ? "Verifying..." : "Verify and sign in"}
                </PrimaryButton>
              </div>
              <button
                type="button"
                onClick={sendOtp}
                className="mt-3 w-full text-center text-sm font-semibold text-blue-700 hover:text-blue-800"
              >
                Resend code
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Step({ label, active, done }) {
  return (
    <span
      className={`rounded-full px-3 py-1 ${
        done
          ? "bg-green-100 text-green-700"
          : active
            ? "bg-blue-100 text-blue-700"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      {done ? "✓ " : ""}
      {label}
    </span>
  );
}

function Divider() {
  return <span className="h-px flex-1 bg-slate-200" />;
}
