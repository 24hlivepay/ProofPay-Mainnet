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
  // PR-3: attach JWT if available
  const token = localStorage.getItem("proofpay-jwt");
  if (token) {
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// PR-3: on 401, fire a custom event so any mounted AuthBanner can react.
// On 503 with "auth not configured", warn once in console (dev/preview only).
api.interceptors.response.use(
  (response) => response,
  (error) => {
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
