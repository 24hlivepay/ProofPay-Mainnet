import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "./index.css";
import App from "./App";

import { EscrowProvider } from "./context/EscrowContext";
import { getCurrentNetworkId } from "./config/network";
import { getNetworkColors } from "./config/networkColors";

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
const currentNetworkId = getCurrentNetworkId();
document.documentElement.dataset.network = currentNetworkId;

const netColors = getNetworkColors(currentNetworkId);
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
