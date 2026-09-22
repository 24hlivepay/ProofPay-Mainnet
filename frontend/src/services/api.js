import axios from "axios";
import { getCurrentNetworkId } from "../config/network";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "/api" : "http://localhost:5001/api");

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Tells the backend which Arc network (mainnet/testnet) this request's
// escrow/Circle-wallet data belongs to — see MAINNET_TODO.md step 4.
api.interceptors.request.use((config) => {
  config.headers["X-ProofPay-Network"] = getCurrentNetworkId();
  // Admin 2FA: /admin/* calls use the short-lived, fully-verified admin
  // session (password + email OTP) stored in sessionStorage -- separate from
  // the regular wallet JWT so it clears when the tab closes and never leaks
  // into normal buyer/seller requests.
  const isAdminRequest = (config.url || "").includes("/admin/");
  const adminToken = isAdminRequest ? sessionStorage.getItem("proofpay-admin-jwt") : null;
  const token = adminToken || localStorage.getItem("proofpay-jwt");
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// PR-3: most pages had no way to get a fresh JWT before acting -- they only
// ever attached whatever token connecting to the app once had left in
// localStorage, so any expired/missing session surfaced as a raw 401 on
// accept/deposit/deliver/release/dispute/etc. Transparently obtain a fresh
// SIWE (or Circle) session and retry the request once instead of failing
// every action that happens to run after the token goes stale.
// /wallet/connect itself is excluded to avoid recursing into its own retry.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error.config;
    const isAuthEndpoint = (config?.url || "").includes("/wallet/connect");
    const isAdminRequest = (config?.url || "").includes("/admin/");

    if (error.response?.status === 401 && isAdminRequest) {
      // A plain wallet reconnect can't restore the password+OTP admin
      // session -- clear the stale token so the admin page redirects to a
      // full re-login instead of silently retrying with the wrong token.
      sessionStorage.removeItem("proofpay-admin-jwt");
      return Promise.reject(error);
    }

    if (error.response?.status === 401 && config && !config._retriedAfterReauth && !isAuthEndpoint) {
      config._retriedAfterReauth = true;
      try {
        const { connectWalletWithOptions } = await import("./wallet.js");
        await connectWalletWithOptions({ requireSignature: true });
        return api(config);
      } catch {
        window.dispatchEvent(new CustomEvent("proofpay:auth-expired"));
        return Promise.reject(error);
      }
    }

    if (error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent("proofpay:auth-expired"));
    }
    if (
      error.response?.status === 503 &&
      error.response?.data?.error === "auth not configured"
    ) {
      console.warn(
        "[ProofPay] SESSION_SECRET is not set — auth enforcement is disabled on this deployment."
      );
    }
    return Promise.reject(error);
  }
);

export default api;
