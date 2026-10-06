import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { getNetworkConfig } from "../config/network";
import { getNetworkColors } from "../config/networkColors";

// Re-read on every load (the network toggle in Navbar.jsx reloads the page
// on switch, so this always reflects the currently selected network — see
// config/network.js for why this isn't just a single VITE_CIRCLE_APP_ID).
const circleAppId = getNetworkConfig().circleAppId;

if (!circleAppId) {
  console.warn(`Circle App ID is not configured for ${getNetworkConfig().chainName}.`);
}

export const circleSdk = new W3SSdk({
  appSettings: {
    appId: circleAppId,
  },
});

// Circle's own window (PIN entry and the confirm screen) cannot be drawn by
// ProofPay -- that is what keeps the PIN and the approval out of our hands --
// but its colours can be set. They follow the current network's accent, so
// the window reads as part of the app: green on mainnet, amber on testnet.
const net = getNetworkColors();

circleSdk.setThemeColor({
  backdrop: "#0f172a",
  backdropOpacity: 0.68,
  bg: "#ffffff",
  divider: net[100],
  success: "#16a34a",
  error: "#dc2626",
  textMain: "#0f172a",
  textMain2: net[800],
  textAuxiliary: "#475569",
  textAuxiliary2: "#64748b",
  textSummary: "#0f172a",
  textSummaryHighlight: net[600],
  textDetailToggle: "#334155",
  textInteractive: "#ffffff",
  interactiveBg: net[600],
  mainBtnText: "#ffffff",
  mainBtnTextOnHover: "#ffffff",
  mainBtnBg: net[600],
  mainBtnBgOnHover: net[700],
  secondBtnText: net[700],
  secondBtnTextOnHover: net[800],
  secondBtnBorder: net[300],
  secondBtnBorderOnHover: net[600],
  secondBtnBgOnHover: net[50],
  plainBtnText: net[700],
  plainBtnTextOnHover: net[800],
  pinDotActivated: net[600],
  inputBorderFocused: net[600],
  dropdownBorderIsOpen: net[600],
});

export function getCircleDeviceId() {
  return circleSdk.getDeviceId();
}

export function verifyCircleEmailOtp(otpSession) {
  return new Promise((resolve, reject) => {
    circleSdk.updateConfigs(
      {
        appSettings: {
          appId: circleAppId,
        },
        loginConfigs: {
          deviceToken: otpSession.deviceToken,
          deviceEncryptionKey: otpSession.deviceEncryptionKey,
          otpToken: otpSession.otpToken,
        },
      },
      (error, result) => {
        if (error) {
          reject(new Error(error.message || "Circle could not verify the email code."));
          return;
        }

        if (!result?.userToken || !result?.encryptionKey) {
          reject(new Error("Circle did not return a valid wallet session."));
          return;
        }

        resolve(result);
      }
    );

    circleSdk.verifyOtp();
  });
}

export function executeCircleChallenge({
  challengeId,
  userToken,
  encryptionKey,
  display,
}) {
  return new Promise((resolve, reject) => {
    circleSdk.setAuthentication({ userToken, encryptionKey });
    if (display) {
      circleSdk.setLocalizations({
        common: {
          confirm: display.confirmLabel || "Confirm",
        },
        contractInteraction: {
          title: display.title,
          subtitle: display.subtitle,
          mainCurrency: {
            amount: display.amount,
            symbol: display.symbol,
          },
          fromLabel: display.fromLabel || "From wallet",
          from: display.from,
          contractAddressLabel: display.contractLabel,
          contractInfo: [display.contractName],
          networkFeeLabel: "Arc network fee",
          networkFeeTip:
            "The final network fee is calculated by Arc when you confirm.",
          totalLabel: display.totalLabel,
          total: [display.total || `${display.amount} ${display.symbol}`],
          dataDetails: {
            dataDetailsLabel: "Transaction details",
            abiInfo: {
              functionNameLabel: "Action",
              functionName: display.action,
              parametersLabel: "Escrow details",
              parameters: display.details,
            },
          },
        },
      });
    }
    circleSdk.execute(challengeId, (error, result) => {
      if (error) {
        reject(new Error(error.message || "Circle could not approve the request."));
        return;
      }

      if (result?.status === "FAILED" || result?.status === "EXPIRED") {
        reject(new Error(`Circle request ended with status: ${result.status}.`));
        return;
      }

      // Circle can return IN_PROGRESS while wallet creation continues
      // asynchronously. The caller polls the wallets endpoint until the new
      // wallet becomes available.
      resolve(result);
    });
  });
}
