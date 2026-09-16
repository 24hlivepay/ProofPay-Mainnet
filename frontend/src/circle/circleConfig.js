import { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";

const circleAppId = import.meta.env.VITE_CIRCLE_APP_ID;

if (!circleAppId) {
  console.warn("VITE_CIRCLE_APP_ID is not configured.");
}

export const circleSdk = new W3SSdk({
  appSettings: {
    appId: circleAppId,
  },
});

circleSdk.setThemeColor({
  backdrop: "#0f172a",
  backdropOpacity: 0.68,
  bg: "#ffffff",
  divider: "#dbeafe",
  success: "#16a34a",
  error: "#dc2626",
  textMain: "#0f172a",
  textMain2: "#1e3a8a",
  textAuxiliary: "#475569",
  textAuxiliary2: "#64748b",
  textSummary: "#0f172a",
  textSummaryHighlight: "#2563eb",
  textDetailToggle: "#334155",
  textInteractive: "#ffffff",
  interactiveBg: "#2563eb",
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
