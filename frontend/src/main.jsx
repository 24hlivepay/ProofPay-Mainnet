import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "./index.css";
import App from "./App";

import { EscrowProvider } from "./context/EscrowContext";
import { getCurrentNetworkId } from "./config/network";

// Drives the blue -> green/amber theme overrides in index.css. Set here
// (not per-component) so it's already on <html> before first paint, and
// Navbar.jsx's network switch reloads the page, so this always re-runs.
//
// The --net-* values themselves are set inline here, in JS, rather than as
// two [data-network="mainnet"/"testnet"] blocks in index.css — Tailwind
// v4's production build (Lightning CSS) treated those two blocks as
// duplicate rules (same custom-property names, different values) and
// silently dropped one, which made every color override in index.css
// resolve to nothing and every "blue" element go invisible.
const NETWORK_COLORS = {
  mainnet: {
    50: "#f0fdf4", 100: "#dcfce7", 200: "#bbf7d0", 300: "#86efac", 400: "#4ade80",
    500: "#22c55e", 600: "#16a34a", 700: "#15803d", 800: "#166534", 900: "#14532d",
  },
  testnet: {
    50: "#fffbeb", 100: "#fef3c7", 200: "#fde68a", 300: "#fcd34d", 400: "#fbbf24",
    500: "#f59e0b", 600: "#d97706", 700: "#b45309", 800: "#92400e", 900: "#78350f",
  },
};

const currentNetworkId = getCurrentNetworkId();
document.documentElement.dataset.network = currentNetworkId;

const netColors = NETWORK_COLORS[currentNetworkId] || NETWORK_COLORS.mainnet;
for (const [shade, hex] of Object.entries(netColors)) {
  document.documentElement.style.setProperty(`--net-${shade}`, hex);
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>

    <EscrowProvider>

      <HashRouter>

        <App />

      </HashRouter>

    </EscrowProvider>

  </React.StrictMode>
);
