import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import "./index.css";
import App from "./App";

import { EscrowProvider } from "./context/EscrowContext";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>

    <EscrowProvider>

      <HashRouter>

        <App />

      </HashRouter>

    </EscrowProvider>

  </React.StrictMode>
);
