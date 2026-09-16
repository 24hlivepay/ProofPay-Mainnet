import { BrowserProvider } from "ethers";

export const ARC_TESTNET_CHAIN_ID = 5042002;
const ARC_TESTNET_CHAIN_HEX = "0x4cef52";
const ARC_TESTNET_NETWORK = {
  chainId: ARC_TESTNET_CHAIN_HEX,
  chainName: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.testnet.arc.network"],
};

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

export async function ensureArcTestnet(onStatus, walletProvider) {
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const walletLabel = WALLET_DETAILS[walletType]?.label || "wallet";
  const ethereum = walletProvider || await getWalletProvider(walletType);
  if (!ethereum) {
    throw new Error(`${WALLET_DETAILS[walletType].label} is not installed.`);
  }

  const currentChainId = await ethereum.request({
    method: "eth_chainId",
  });

  if (currentChainId.toLowerCase() === ARC_TESTNET_CHAIN_HEX) {
    return "already-connected";
  }

  try {
    onStatus?.(`Switching ${walletLabel} to Arc Testnet...`);
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ARC_TESTNET_CHAIN_HEX }],
    });
    return "switched";
  } catch (error) {
    if (error.code === 4902) {
      try {
        onStatus?.(`Arc Testnet is not in ${walletLabel}. Adding it now...`);
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [ARC_TESTNET_NETWORK],
        });
        onStatus?.("Arc Testnet added. Switching your wallet...");
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: ARC_TESTNET_CHAIN_HEX }],
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
  const networkStatus = await ensureArcTestnet(onStatus, ethereum);

  const provider = new BrowserProvider(ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  localStorage.setItem("proofpay-wallet", address);

  if (!requireSignature) {
    return { provider, signer, address, networkStatus };
  }

  const signedAt = new Date().toISOString();
  const message = [
    "Sign in to ProofPay.",
    "",
    `Wallet: ${address}`,
    `Issued at: ${signedAt}`,
    "",
    "This signature proves you control this wallet. It does not create a transaction or charge gas.",
  ].join("\n");
  const signature = await signer.signMessage(message);
  const session = { address, message, signature, signedAt };

  localStorage.setItem("proofpay-wallet-session", JSON.stringify(session));

  return { provider, signer, ...session, networkStatus };
}

export function getWalletErrorMessage(error) {
  const message = error?.message || "";

  if (error?.code === 4001 || /user rejected|user denied/i.test(message)) {
    return "You cancelled the MetaMask request. You can connect whenever you are ready.";
  }

  if (/not installed/i.test(message)) {
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
  sessionStorage.removeItem("proofpay-circle-auth");
  sessionStorage.removeItem("proofpay-circle-otp-session");
}
