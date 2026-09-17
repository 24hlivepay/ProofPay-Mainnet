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
document.documentElement.dataset.network = getCurrentNetworkId();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>

    <EscrowProvider>

      <HashRouter>

        <App />

      </HashRouter>

    </EscrowProvider>

  </React.StrictMode>
);
