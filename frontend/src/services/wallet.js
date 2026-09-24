import { BrowserProvider } from "ethers";
import { getCurrentNetworkId, getNetworkConfig } from "../config/network";

function getWalletAddEthereumChainParams(network = getNetworkConfig()) {
  return {
    chainId: network.chainHex,
    chainName: network.chainName,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [network.rpcUrl],
  };
}

const WALLET_DETAILS = {
  metamask: {
    label: "MetaMask",
    rdns: "io.metamask",
    matches: (provider) =>
      provider?.isMetaMask &&
      !provider?.isZerion &&
      !provider?.isRabby &&
      !provider?.isPhantom &&
      !provider?.isCoinbaseWallet,
  },
  rabby: {
    label: "Rabby Wallet",
    rdns: "io.rabby",
    matches: (provider) => Boolean(provider?.isRabby),
  },
};

function getInjectedWallet(walletType) {
  const wallet = WALLET_DETAILS[walletType] || WALLET_DETAILS.metamask;
  const injected = window.ethereum;
  const providers = injected?.providers || [];

  return (
    providers.find(wallet.matches) ||
    (wallet.matches(injected) ? injected : null)
  );
}

async function getWalletProvider(walletType) {
  if (walletType === "circle") {
    return null;
  }

  const wallet = WALLET_DETAILS[walletType] || WALLET_DETAILS.metamask;
  const announcedProviders = [];
  const handleProvider = (event) => announcedProviders.push(event.detail);
  window.addEventListener("eip6963:announceProvider", handleProvider);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  window.removeEventListener("eip6963:announceProvider", handleProvider);

  const exactProvider = announcedProviders.find(
    ({ info }) => info?.rdns === wallet.rdns
  )?.provider;

  return exactProvider || getInjectedWallet(walletType);
}

export async function ensureArcNetwork(onStatus, walletProvider) {
  const network = getNetworkConfig();
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const walletLabel = WALLET_DETAILS[walletType]?.label || "wallet";
  const ethereum = walletProvider || await getWalletProvider(walletType);
  if (!ethereum) {
    throw new Error(`${WALLET_DETAILS[walletType].label} is not installed.`);
  }

  const currentChainId = await ethereum.request({
    method: "eth_chainId",
  });

  if (currentChainId.toLowerCase() === network.chainHex) {
    return "already-connected";
  }

  try {
    onStatus?.(`Switching ${walletLabel} to ${network.chainName}...`);
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: network.chainHex }],
    });
    return "switched";
  } catch (error) {
    if (error.code === 4902) {
      try {
        onStatus?.(`${network.chainName} is not in ${walletLabel}. Adding it now...`);
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [getWalletAddEthereumChainParams(network)],
        });
        onStatus?.(`${network.chainName} added. Switching your wallet...`);
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: network.chainHex }],
        });
        return "added-and-switched";
      } catch (addError) {
        throw new Error(getWalletErrorMessage(addError));
      }
    }

    throw new Error(getWalletErrorMessage(error));
  }
}

export async function connectWallet() {
  return connectWalletWithOptions({
    walletType: localStorage.getItem("proofpay-wallet-type") || "metamask",
  });
}

export async function connectWalletWithOptions({
  requireSignature = false,
  requestAccountSelection = false,
  walletType = localStorage.getItem("proofpay-wallet-type") || "metamask",
  onStatus,
} = {}) {
  if (walletType === "circle") {
    const session = getWalletSession();
    const auth = getCircleAuthSession();

    if (!session?.address || !session?.walletId || !auth?.userToken) {
      throw new Error(
        "Your Circle wallet session has expired. Sign in with email again."
      );
    }

    // PR-3: verify Circle userToken server-side and get a JWT
    if (requireSignature) {
      try {
        const { default: api } = await import("./api.js");
        const connectRes = await api.post("/wallet/connect", {
          address: session.address,
          walletType: "circle",
          network: getCurrentNetworkId(),
        }, {
          headers: { "X-User-Token": auth.userToken },
        });
        const jwt = connectRes.data?.token;
        if (jwt) {
          localStorage.setItem("proofpay-jwt", jwt);
        }
      } catch (err) {
        // The backend rejects an expired/invalid/unknown Circle userToken
        // with a 401 and { message, circleExpired } -- that message lives on
        // err.response.data, not err.message (axios's own generic wrapper
        // text, e.g. "Request failed with status code 401"). Checking the
        // wrong field meant this branch never matched, so an expired Circle
        // session failed silently: no JWT stored, no error shown, callers
        // (like the admin sign-in flow) had no way to tell connect actually
        // failed until a later, unrelated-looking "no token" error.
        const backendMessage = err?.response?.data?.message;
        if (err?.response?.data?.circleExpired || /circle session has expired/i.test(backendMessage || "")) {
          throw new Error(backendMessage || "Your Circle session has expired. Sign in with email again.");
        }
        // Other connect failures (network down, etc.) don't block session --
        // the caller still gets an address back, just no fresh JWT.
      }
    }

    return {
      address: session.address,
      walletId: session.walletId,
      networkStatus: "already-connected",
    };
  }

  const wallet = WALLET_DETAILS[walletType] || WALLET_DETAILS.metamask;
  const ethereum = await getWalletProvider(walletType);
  if (!ethereum) {
    throw new Error(`${wallet.label} is not installed.`);
  }

  localStorage.setItem("proofpay-wallet-type", walletType);
  onStatus?.(requestAccountSelection ? `Choose the ${wallet.label} account you want to use...` : `Connecting ${wallet.label}...`);

  if (requestAccountSelection) {
    if (walletType === "rabby") {
      // Rabby does not consistently reopen an account picker for
      // wallet_requestPermissions. Revoking the dapp permission first forces
      // a fresh connection request where the user can choose another account.
      try {
        await ethereum.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Older Rabby versions may not expose permission revocation. The
        // request below still reopens Rabby's connection interface.
      }
    } else {
      await ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
    }
  }

  await ethereum.request({ method: "eth_requestAccounts" });
  const networkStatus = await ensureArcNetwork(onStatus, ethereum);

  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  localStorage.setItem("proofpay-wallet", address);

  if (!requireSignature) {
    return { provider, signer, address, networkStatus };
  }

  // PR-3: fetch a SIWE nonce and build an EIP-4361 message so the backend
  // can verify wallet ownership instead of just storing the signature.
  let message, signature, signedAt;
  try {
    const { API_BASE_URL } = await import("./api.js");
    const nonceRes = await fetch(`${API_BASE_URL}/auth/nonce`, {
      headers: { "X-ProofPay-Network": getCurrentNetworkId() },
    });
    const nonceData = await nonceRes.json();

    signedAt = new Date().toISOString();
    if (nonceData?.nonce) {
      // SIWE / EIP-4361 style message — backend verifies with verifyEoaSignature()
      const network = getNetworkConfig();
      // domain/URI must equal the page's real origin: wallets compare them and
      // show a red "Review alert" phishing warning on any mismatch (the site
      // is served from www.proofpay.online, so a hardcoded apex domain always
      // tripped it). The backend allowlist decides which hosts are accepted.
      message = [
        `${window.location.host} wants you to sign in with your Ethereum account:`,
        address,
        "",
        "Sign in to ProofPay. This does not create a transaction.",
        "",
        `URI: ${window.location.origin}`,
        `Version: 1`,
        `Chain ID: ${network.chainId}`,
        `Nonce: ${nonceData.nonce}`,
        `Issued At: ${signedAt}`,
        `Expiration Time: ${new Date(Date.now() + 5 * 60 * 1000).toISOString()}`,
      ].join("\n");
    } else {
      // Fallback: legacy message if nonce endpoint not available
      message = [
        "Sign in to ProofPay.",
        "",
        `Wallet: ${address}`,
        `Issued at: ${signedAt}`,
        "",
        "This signature proves you control this wallet. It does not create a transaction or charge gas.",
      ].join("\n");
    }

    signature = await signer.signMessage(message);
  } catch {
    // If nonce fetch fails (network/backend down), fall back to legacy message
    signedAt = new Date().toISOString();
    message = [
      "Sign in to ProofPay.",
      "",
      `Wallet: ${address}`,
      `Issued at: ${signedAt}`,
      "",
      "This signature proves you control this wallet. It does not create a transaction or charge gas.",
    ].join("\n");
    signature = await signer.signMessage(message);
  }

  const session = { address, message, signature, signedAt };
  localStorage.setItem("proofpay-wallet-session", JSON.stringify(session));

  // PR-3: post to /wallet/connect and store the returned JWT
  try {
    const { default: api } = await import("./api.js");
    const connectRes = await api.post("/wallet/connect", {
      address,
      message,
      signature,
      walletType: "metamask",
      network: getCurrentNetworkId(),
    });
    const jwt = connectRes.data?.token;
    if (jwt) {
      localStorage.setItem("proofpay-jwt", jwt);
    }
  } catch (err) {
    // This used to be a bare `catch {}` -- any /wallet/connect failure
    // (bad nonce, domain mismatch, backend error) was silently ignored,
    // so the function still resolved "successfully" with an address but
    // no JWT. Every requireAuth()-protected action after that then failed
    // with a confusing, unrelated-looking error. The caller asked for
    // requireSignature specifically because it needs a proven session, so
    // surface the real reason instead of pretending this succeeded.
    throw new Error(err?.response?.data?.message || "Could not verify your wallet session. Please try again.");
  }

  return { provider, signer, ...session, networkStatus };
}

export function getWalletErrorMessage(error) {
  const message = error?.message || "";

  if (error?.code === 4001 || /user rejected|user denied/i.test(message)) {
    return "You cancelled the MetaMask request. You can connect whenever you are ready.";
  }

  if (/not installed/i.test(message) || /circle wallet session has expired/i.test(message)) {
    return message;
  }

  return "We could not connect your wallet. Please unlock MetaMask or Rabby and try again.";
}

export function getConnectedWallet() {
  return localStorage.getItem("proofpay-wallet");
}

export function getWalletSession() {
  try {
    return JSON.parse(localStorage.getItem("proofpay-wallet-session"));
  } catch {
    return null;
  }
}

export function saveCircleAuthSession(auth) {
  const persistedAuth = {
    ...auth,
    savedAt: Date.now(),
  };

  localStorage.setItem(
    "proofpay-circle-auth",
    JSON.stringify(persistedAuth)
  );
  sessionStorage.setItem(
    "proofpay-circle-auth",
    JSON.stringify(persistedAuth)
  );
}

export function getCircleAuthSession() {
  try {
    const rawAuth =
      sessionStorage.getItem("proofpay-circle-auth") ||
      localStorage.getItem("proofpay-circle-auth");
    const auth = JSON.parse(rawAuth || "null");

    if (auth?.userToken && auth?.encryptionKey) {
      sessionStorage.setItem(
        "proofpay-circle-auth",
        JSON.stringify(auth)
      );
      return auth;
    }
  } catch {
    // Invalid persisted auth is cleared by the normal sign-out flow.
  }

  return null;
}

export async function disconnectWallet() {
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const ethereum = walletType === "circle" ? null : await getWalletProvider(walletType);
  if (ethereum) {
    try {
      await ethereum.request({
        method: "wallet_revokePermissions",
        params: [{ eth_accounts: {} }],
      });
    } catch {
      // Some injected wallets do not support permission revocation. The local
      // ProofPay session is still cleared below.
    }
  }

  localStorage.removeItem("proofpay-wallet");
  localStorage.removeItem("proofpay-wallet-session");
  localStorage.removeItem("proofpay-wallet-type");
  localStorage.removeItem("proofpay-email");
  localStorage.removeItem("proofpay-circle-auth");
  localStorage.removeItem("proofpay-last-safe-route");
  localStorage.removeItem("proofpay-jwt"); // PR-3
  sessionStorage.removeItem("proofpay-circle-auth");
  sessionStorage.removeItem("proofpay-circle-otp-session");
}
