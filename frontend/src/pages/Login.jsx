import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";
import { getCircleDeviceId } from "../circle/circleConfig";
import api from "../services/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleContinue(event) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError("Enter a valid email address.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const deviceId = await getCircleDeviceId();
      const response = await api.post("/circle/request-email-otp", {
        email: normalizedEmail,
        deviceId,
      });

      sessionStorage.setItem(
        "proofpay-circle-otp-session",
        JSON.stringify(response.data.data)
      );
      localStorage.setItem("proofpay-email", normalizedEmail);
      navigate("/otp");
    } catch (requestError) {
      setError(
        requestError.response?.data?.message ||
          requestError.response?.data?.error?.message ||
          requestError.message ||
          "We could not send the verification code. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />

      <main className="mx-auto max-w-md px-5 py-12 sm:px-6">
        <form onSubmit={handleContinue} className="rounded-2xl bg-white p-6 shadow sm:p-8">
          <h1 className="text-3xl font-bold text-slate-950">Continue with Email</h1>
          <p className="mt-3 text-slate-600">
            Circle will send a one-time verification code to create or open your user-controlled wallet.
          </p>

          <label htmlFor="email" className="mt-8 block text-sm font-semibold text-slate-700">
            Email address
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={loading}
            className="mt-2 w-full rounded-xl border border-slate-300 p-4 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100 disabled:bg-slate-100"
          />

          {error && (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="mt-8">
            <PrimaryButton type="submit" disabled={loading}>
              {loading ? "Sending code..." : "Send verification code"}
            </PrimaryButton>
          </div>

          <p className="mt-5 text-center text-xs leading-5 text-slate-500">
            Your wallet is controlled by you and linked to your verified Circle email identity.
          </p>
        </form>
      </main>
    </div>
  );
}
