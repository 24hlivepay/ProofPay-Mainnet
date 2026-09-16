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
  return config;
});

export default api;
