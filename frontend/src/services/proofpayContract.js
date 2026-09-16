import { Contract, formatUnits, Interface, JsonRpcProvider, parseUnits } from "ethers";
import { connectWallet } from "./wallet";
import { executeCircleContract } from "./circleTransactions";
import { ESCROW_ASSETS, getEscrowAsset } from "../config/escrowAssets";

export const PROOFPAY_ESCROW_ADDRESS =
  "0xCd0f43E573899809ff96C560439570A760698C9a";

export const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

// Arc's RPC can fail during gas estimation for the native-USDC ERC-20
// precompile even though the signed transaction itself is valid. Supplying
// conservative limits lets MetaMask submit the transaction normally; unused
// gas is not charged.
const ARC_APPROVAL_GAS_LIMIT = 250_000n;
const ARC_ESCROW_GAS_LIMIT = 500_000n;
const ARC_STATUS_UPDATE_GAS_LIMIT = 250_000n;
const USDC_DECIMALS = 6;
const NETWORK_FEE_RESERVE = parseUnits("0.01", USDC_DECIMALS);
const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
const PROOFPAY_DEPLOYMENT_BLOCK = 53_590_676;
const ARC_LOG_BLOCK_WINDOW = 9_000;

const ESCROW_ABI = [
  "function createEscrow(string escrowId, address seller, uint256 amount)",
  "function confirmDelivery(string escrowId)",
  "function releaseFunds(string escrowId)",
  "function refund(string escrowId)",
  "function openDispute(string escrowId)",
  "function resolveDispute(string escrowId, uint256 buyerAmount)",
  "function getEscrow(string escrowId) view returns (address buyer, address seller, uint256 amount, uint8 status)",
  "event EscrowCreated(string indexed escrowId, address indexed buyer, address indexed seller, uint256 amount)",
  "event DeliveryConfirmed(string indexed escrowId, address indexed seller)",
  "event FundsReleased(string indexed escrowId, address indexed seller, uint256 amount)",
  "event FundsRefunded(string indexed escrowId, address indexed buyer, uint256 amount)",
  "event DisputeOpened(string indexed escrowId, address indexed openedBy)",
  "event DisputeResolved(string indexed escrowId, uint256 buyerAmount, uint256 sellerAmount)",
];

const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

const escrowInterface = new Interface(ESCROW_ABI);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ARC_READ_RETRY_DELAYS_MS = [0, 350, 900];
const ON_CHAIN_STATUS = {
  FUNDED: 1,
  DELIVERED: 2,
  RELEASED: 3,
  REFUNDED: 4,
  DISPUTED: 5,
};

function technicalError(error) {
  return (
    error?.reason ||
    error?.shortMessage ||
    error?.info?.error?.message ||
    error?.data?.message ||
    error?.message ||
    "Transaction failed."
  );
}

function isTransientArcCallError(error) {
  const message = technicalError(error).toLowerCase();

  return (
    error?.code === "CALL_EXCEPTION" ||
    message.includes("missing revert data") ||
    message.includes("could not coalesce")
  );
}

function readableError(error) {
  const message = technicalError(error);
  const normalizedMessage = message.toLowerCase();
  const walletType = localStorage.getItem("proofpay-wallet-type") || "metamask";
  const walletName = walletType === "rabby"
    ? "Rabby"
    : walletType === "circle"
      ? "Circle wallet"
      : "MetaMask";

  if (
    normalizedMessage.includes("user rejected") ||
    normalizedMessage.includes("user denied") ||
    error?.code === 4001
  ) {
    return "You cancelled the MetaMask request. No funds were moved. Tap Deposit again whenever you are ready.";
  }

  if (
    normalizedMessage.includes("insufficient funds") ||
    normalizedMessage.includes("insufficient balance")
  ) {
    return "Your wallet does not have enough USDC. Add USDC for both the payment and the small Arc network fee, then try again.";
  }

  if (
    normalizedMessage.includes("wrong network") ||
    normalizedMessage.includes("chain")
  ) {
    return "Your wallet is on the wrong network. Open MetaMask, switch to Arc Testnet, then try again.";
  }

  if (
    normalizedMessage.includes("could not coalesce") ||
    normalizedMessage.includes("missing revert data") ||
    normalizedMessage.includes("call exception")
  ) {
    return "MetaMask could not prepare this payment. Check that the buyer wallet is selected, it is on Arc Testnet, and it has a small extra USDC balance for the network fee. No funds were moved.";
  }

  if (
    message.startsWith("Buyer wallet") ||
    message.startsWith("Buyer wallet has") ||
    message.startsWith("Your payment has not started") ||
    message.startsWith("Unable to read buyer USDC balance") ||
    message.startsWith("Arc Testnet could not read") ||
    message.startsWith("USDC approval failed") ||
    message.startsWith("USDC lock transaction failed") ||
    message.startsWith("Wallet connection failed") ||
    message.startsWith("This escrow ID already exists") ||
    message.startsWith("The USDC is already locked") ||
    message.startsWith("Connect the original buyer wallet") ||
    message.startsWith("Delivery is not confirmed on-chain") ||
    message.startsWith("This escrow has already been released") ||
    message.startsWith("Switch MetaMask") ||
    message.startsWith("Wallet connection") ||
    message.startsWith("MetaMask is not installed")
  ) {
    return message;
  }

  console.error("ProofPay transaction error:", error);
  return `We could not complete this payment. No funds were moved. Please reopen ${walletName}, confirm the buyer wallet and Arc Testnet, then try again.`;
}

async function getContracts(assetSymbol = "USDC") {
  let wallet;

  try {
    wallet = await connectWallet();
  } catch (error) {
    throw new Error(`Wallet connection failed: ${readableError(error)}`);
  }

  const asset = getEscrowAsset(assetSymbol);

  return {
    address: wallet.address,
    provider: wallet.provider,
    asset,
    escrow: new Contract(asset.escrowAddress, ESCROW_ABI, wallet.signer),
    usdc: new Contract(asset.tokenAddress, USDC_ABI, wallet.signer),
  };
}

function getAssetAmount(amount, decimals = USDC_DECIMALS) {
  return parseUnits(String(amount), decimals);
}

function isCircleWallet() {
  return localStorage.getItem("proofpay-wallet-type") === "circle";
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readUsdcBalance(address, connectedUsdc, tokenAddress = ARC_TESTNET_USDC_ADDRESS) {
  const publicProvider = new JsonRpcProvider(ARC_TESTNET_RPC_URL);
  const publicUsdc = new Contract(
    tokenAddress,
    USDC_ABI,
    publicProvider
  );
  let lastError;

  for (const delay of ARC_READ_RETRY_DELAYS_MS) {
    if (delay) await wait(delay);

    for (const usdc of [connectedUsdc, publicUsdc].filter(Boolean)) {
      try {
        return await usdc.balanceOf(address);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw new Error(
    "Arc Testnet could not read the buyer USDC balance after several attempts. Please wait a moment and try again.",
    { cause: lastError }
  );
}

async function readEscrowWithRetry(
  escrowId,
  connectedEscrow,
  escrowAddress = PROOFPAY_ESCROW_ADDRESS
) {
  const publicProvider = new JsonRpcProvider(ARC_TESTNET_RPC_URL);
  const publicEscrow = new Contract(
    escrowAddress,
    ESCROW_ABI,
    publicProvider
  );
  let lastError;

  for (const delay of ARC_READ_RETRY_DELAYS_MS) {
    if (delay) await wait(delay);

    for (const escrow of [connectedEscrow, publicEscrow].filter(Boolean)) {
      try {
        return await escrow.getEscrow(escrowId);
      } catch (error) {
        lastError = error;
      }
    }
  }

  const readError = new Error(
    "Your payment has not started and no funds were deducted. Please wait a few seconds, then try again.",
    { cause: lastError }
  );
  readError.code = "ARC_ESCROW_READ_UNAVAILABLE";
  throw readError;
}

function validateReleaseRequest(onChainEscrow, buyerAddress) {
  if (
    !buyerAddress ||
    onChainEscrow.buyer.toLowerCase() !== buyerAddress.toLowerCase()
  ) {
    const expectedBuyer = onChainEscrow.buyer;
    throw new Error(
      `Connect the original buyer wallet (${expectedBuyer.slice(0, 6)}...${expectedBuyer.slice(-4)}) to release these funds.`
    );
  }

  const status = Number(onChainEscrow.status);

  if (status === ON_CHAIN_STATUS.RELEASED) {
    throw new Error(
      "This escrow has already been released on-chain. Refresh the order before trying again."
    );
  }

  if (status !== ON_CHAIN_STATUS.DELIVERED) {
    throw new Error(
      "Delivery is not confirmed on-chain yet. Ask the seller to complete the Confirm Delivery wallet transaction first."
    );
  }
}

async function recoverExistingEscrow({
  escrowId,
  buyerAddress,
  sellerAddress,
  amountUnits,
  asset,
  provider: connectedProvider,
}) {
  const provider =
    connectedProvider || new JsonRpcProvider(ARC_TESTNET_RPC_URL);
  const escrow = new Contract(asset.escrowAddress, ESCROW_ABI, provider);
  const existing = await readEscrowWithRetry(
    escrowId,
    escrow,
    asset.escrowAddress
  );

  if (existing.buyer.toLowerCase() === ZERO_ADDRESS) {
    return null;
  }

  const matchesRequest =
    existing.buyer.toLowerCase() === buyerAddress.toLowerCase() &&
    existing.seller.toLowerCase() === sellerAddress.toLowerCase() &&
    existing.amount === amountUnits;

  if (!matchesRequest) {
    throw new Error(
      "This escrow ID already exists on-chain with different payment details. Please create a new escrow."
    );
  }

  const latestBlock = await provider.getBlockNumber();
  const topics = escrowInterface.encodeFilterTopics("EscrowCreated", [
    escrowId,
    buyerAddress,
    sellerAddress,
  ]);

  for (
    let toBlock = latestBlock;
    toBlock >= PROOFPAY_DEPLOYMENT_BLOCK;
    toBlock -= ARC_LOG_BLOCK_WINDOW
  ) {
    const fromBlock = Math.max(
      PROOFPAY_DEPLOYMENT_BLOCK,
      toBlock - ARC_LOG_BLOCK_WINDOW + 1
    );
    const logs = await provider.getLogs({
      address: asset.escrowAddress,
      topics,
      fromBlock,
      toBlock,
    });

    if (logs[0]?.transactionHash) {
      return { hash: logs[0].transactionHash, recovered: true };
    }
  }

  throw new Error(
    `The ${asset.symbol} is already locked on-chain, but ProofPay could not locate its deposit transaction. Please contact support with the escrow ID.`
  );
}

async function executeCircleProofPay({
  contractAddress,
  abiFunctionSignature,
  abiParameters,
  onSubmitted,
  display,
}) {
  try {
    return await executeCircleContract({
      contractAddress,
      abiFunctionSignature,
      abiParameters,
      onSubmitted,
      display,
    });
  } catch (error) {
    const message =
      error.response?.data?.message ||
      error.response?.data?.error?.message ||
      error.message;
    throw new Error(
      message || "Circle could not complete the transaction.",
      { cause: error }
    );
  }
}

export async function fundEscrow({ escrowId, sellerAddress, amount, assetSymbol = "USDC" }) {
  const asset = getEscrowAsset(assetSymbol);

  if (isCircleWallet()) {
    const walletAddress = localStorage.getItem("proofpay-wallet");
    const amountUnits = getAssetAmount(amount, asset.decimals);
    let recovered;

    try {
      recovered = await recoverExistingEscrow({
        escrowId,
        buyerAddress: walletAddress,
        sellerAddress,
        amountUnits,
        asset,
      });
    } catch (error) {
      // Circle wallets do not expose an injected RPC provider. A temporary
      // browser-to-Arc read failure must not block a new deposit: the escrow
      // contract still rejects duplicate IDs and mismatched requests on-chain.
      if (error.code !== "ARC_ESCROW_READ_UNAVAILABLE") {
        throw error;
      }

      console.warn("Circle escrow preflight was unavailable; continuing safely.", error);
    }

    if (recovered) return recovered;

    // Do not preflight Circle wallets with ERC-20 balanceOf. Arc's native-USDC
    // precompile intermittently rejects that public RPC read even when the
    // wallet is funded. Circle validates the balance when it prepares the
    // approval and escrow transactions, so this redundant read only creates
    // false deposit failures.
    await executeCircleProofPay({
      contractAddress: asset.tokenAddress,
      abiFunctionSignature: "approve(address,uint256)",
      abiParameters: [asset.escrowAddress, amountUnits.toString()],
      display: {
        title: `Approve ${asset.symbol}`,
        subtitle:
          `Step 1 of 2 • Authorize the exact escrow amount. No ${asset.symbol} moves in this step.`,
        amount: String(amount),
        symbol: asset.symbol,
        fromLabel: "Authorizing wallet",
        from: walletAddress,
        contractLabel: "Permission for",
        contractName: "Verified ProofPay Escrow",
        totalLabel: "Approval limit",
        confirmLabel: `Authorize ${asset.symbol}`,
        action: `Authorize exact ${asset.symbol} allowance`,
        details: [
          `Escrow ID: ${escrowId}`,
          `Seller: ${sellerAddress}`,
          "Network: Arc Testnet",
          "Access: Exact amount only",
          "Funds movement: None in this step",
        ],
      },
    });
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "createEscrow(string,address,uint256)",
      abiParameters: [escrowId, sellerAddress, amountUnits.toString()],
      display: {
        title: "Lock Escrow Funds",
        subtitle:
          `Step 2 of 2 • Transfer ${asset.symbol} from your wallet into the escrow contract.`,
        amount: String(amount),
        symbol: asset.symbol,
        fromLabel: "Funding wallet",
        from: walletAddress,
        contractLabel: "Funds destination",
        contractName: "Verified ProofPay Escrow",
        totalLabel: "Amount to lock",
        confirmLabel: `Lock ${amount} ${asset.symbol}`,
        action: "Lock funds in escrow",
        details: [
          `Escrow ID: ${escrowId}`,
          `Seller: ${sellerAddress}`,
          "Network: Arc Testnet",
          "Funds destination: ProofPay Escrow contract",
          "Protection: Release after delivery",
        ],
      },
    });

    return { hash: transaction.hash };
  }

  try {
    const { address, provider, escrow, usdc } = await getContracts(assetSymbol);
    const amountUnits = getAssetAmount(amount, asset.decimals);
    const recovered = await recoverExistingEscrow({
      escrowId,
      buyerAddress: address,
      sellerAddress,
      amountUnits,
      asset,
      provider,
    });
    if (recovered) return recovered;

    let balance;

    try {
      balance = await readUsdcBalance(address, usdc, asset.tokenAddress);
    } catch (error) {
      throw new Error(
        `Unable to read buyer ${asset.symbol} balance: ${readableError(error)}`,
        { cause: error }
      );
    }

    const minimumRequired = amountUnits + (
      asset.symbol === "USDC" ? NETWORK_FEE_RESERVE : 0n
    );

    if (balance < minimumRequired) {
      throw new Error(
        `Buyer wallet has ${formatUnits(balance, asset.decimals)} ${asset.symbol}. This escrow needs ${amount} ${asset.symbol}.`
      );
    }

    // Arc's native-USDC precompile can intermittently reject an allowance
    // read through browser RPC. A fresh, exact approval is safe and avoids
    // that unreliable read before every escrow deposit.
    let approval;

    try {
      approval = await usdc.approve(
        asset.escrowAddress,
        amountUnits,
        {
          gasLimit: ARC_APPROVAL_GAS_LIMIT,
        }
      );
      await approval.wait();
    } catch (error) {
      throw new Error(`${asset.symbol} approval failed: ${readableError(error)}`);
    }

    let transaction;
    let receipt;

    try {
      transaction = await escrow.createEscrow(
        escrowId,
        sellerAddress,
        amountUnits,
        {
          gasLimit: ARC_ESCROW_GAS_LIMIT,
        }
      );
      receipt = await transaction.wait();
    } catch (error) {
      throw new Error(`${asset.symbol} lock transaction failed: ${readableError(error)}`);
    }

    return { hash: transaction.hash, receipt };
  } catch (error) {
    throw new Error(readableError(error));
  }
}

async function readOnChainEscrowStatus(escrowId, asset) {
  try {
    const provider = new JsonRpcProvider(ARC_TESTNET_RPC_URL);
    const publicEscrow = new Contract(asset.escrowAddress, ESCROW_ABI, provider);
    const onChainEscrow = await readEscrowWithRetry(escrowId, publicEscrow, asset.escrowAddress);
    return Number(onChainEscrow.status);
  } catch {
    return null;
  }
}

async function isAlreadyDeliveredOnChain(escrowId, asset) {
  return (await readOnChainEscrowStatus(escrowId, asset)) === ON_CHAIN_STATUS.DELIVERED;
}

async function isAlreadyDisputedOnChain(escrowId, asset) {
  return (await readOnChainEscrowStatus(escrowId, asset)) === ON_CHAIN_STATUS.DISPUTED;
}

export async function confirmDeliveryOnChain(escrowId, assetSymbol = "USDC") {
  const asset = getEscrowAsset(assetSymbol);

  if (isCircleWallet()) {
    const walletAddress = localStorage.getItem("proofpay-wallet");
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "confirmDelivery(string)",
      abiParameters: [escrowId],
      display: {
        title: "Confirm Delivery",
        subtitle:
          `Send an on-chain delivery signal to the ProofPay escrow. This does not release or transfer the locked ${asset.symbol}.`,
        amount: "0",
        symbol: asset.symbol,
        fromLabel: "Confirming seller wallet",
        from: walletAddress,
        contractLabel: "Verified contract",
        contractName: "ProofPay Escrow",
        totalLabel: "Funds moved",
        total: `0 ${asset.symbol} — status update only`,
        confirmLabel: "Confirm Delivery",
        action: "Confirm delivery status",
        details: [
          `Escrow ID: ${escrowId}`,
          "Network: Arc Testnet",
          "Action: Mark order as delivered",
          `Locked ${asset.symbol}: Not released`,
          "Funds movement: None",
        ],
      },
    });
    return transaction.hash;
  }

  try {
    const { escrow } = await getContracts(assetSymbol);
    const transaction = await escrow.confirmDelivery(escrowId, {
      gasLimit: ARC_STATUS_UPDATE_GAS_LIMIT,
    });
    await transaction.wait();
    return transaction.hash;
  } catch (error) {
    // A prior attempt can succeed on-chain even when its confirmation never
    // reached this browser (a dropped RPC response, a closed tab). Retrying
    // then reverts here because the contract is no longer in "Funded"
    // status. Treat that as success so the caller can sync ProofPay's record
    // instead of showing a permanent "Interaction failed" loop.
    if (await isAlreadyDeliveredOnChain(escrowId, asset)) return "";
    throw new Error(readableError(error));
  }
}

export async function releaseFundsOnChain(
  escrowId,
  onSubmitted,
  assetSymbol = "USDC",
  fallbackEscrow
) {
  const asset = getEscrowAsset(assetSymbol);

  if (isCircleWallet()) {
    const provider = new JsonRpcProvider(ARC_TESTNET_RPC_URL);
    const readOnlyEscrow = new Contract(
      asset.escrowAddress,
      ESCROW_ABI,
      provider
    );
    let onChainEscrow;

    try {
      onChainEscrow = await readEscrowWithRetry(
        escrowId,
        readOnlyEscrow,
        asset.escrowAddress
      );
    } catch (error) {
      if (error.code !== "ARC_ESCROW_READ_UNAVAILABLE") {
        throw error;
      }

      if (
        fallbackEscrow?.status !== "Delivered" ||
        !fallbackEscrow?.buyerWallet ||
        !fallbackEscrow?.sellerWallet ||
        !fallbackEscrow?.amount
      ) {
        throw new Error(
          "ProofPay could not refresh this delivery. Return to Active Purchases and try again.",
          { cause: error }
        );
      }

      onChainEscrow = {
        buyer: fallbackEscrow.buyerWallet,
        seller: fallbackEscrow.sellerWallet,
        amount: parseUnits(String(fallbackEscrow.amount), asset.decimals),
        status: ON_CHAIN_STATUS.DELIVERED,
      };
      console.warn("Circle release preflight was unavailable; using verified order data.", error);
    }
    const releaseAmount = formatUnits(onChainEscrow.amount, asset.decimals);
    const sellerAddress = onChainEscrow.seller;
    const walletAddress = localStorage.getItem("proofpay-wallet");
    validateReleaseRequest(onChainEscrow, walletAddress);
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "releaseFunds(string)",
      abiParameters: [escrowId],
      onSubmitted,
      display: {
        title: "Release Payment",
        subtitle:
          "Authorize the escrow contract to release its locked funds to the seller.",
        amount: releaseAmount,
        symbol: asset.symbol,
        fromLabel: "Authorizing wallet",
        from: walletAddress,
        contractLabel: "Verified contract",
        contractName: "ProofPay Escrow",
        totalLabel: "Locked funds to release",
        confirmLabel: "Authorize Release",
        action: "Authorize contract release",
        details: [
          `Escrow ID: ${escrowId}`,
          `Recipient: ${sellerAddress}`,
          "Network: Arc Testnet",
          "Status: Delivery confirmed",
          "Funds source: ProofPay Escrow contract",
          "Warning: This action cannot be reversed",
        ],
      },
    });
    return transaction.hash;
  }

  try {
    const { address, escrow } = await getContracts(assetSymbol);
    const onChainEscrow = await readEscrowWithRetry(
      escrowId,
      escrow,
      asset.escrowAddress
    );
    validateReleaseRequest(onChainEscrow, address);
    let transaction;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        transaction = await escrow.releaseFunds(escrowId, {
          gasLimit: ARC_STATUS_UPDATE_GAS_LIMIT,
        });
        break;
      } catch (error) {
        if (attempt === 0 && isTransientArcCallError(error)) {
          await wait(700);
          continue;
        }

        throw error;
      }
    }

    onSubmitted?.(transaction.hash);
    await transaction.wait();
    return transaction.hash;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function refundOnChain(escrowId, assetSymbol = "USDC") {
  const asset = getEscrowAsset(assetSymbol);

  if (isCircleWallet()) {
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "refund(string)",
      abiParameters: [escrowId],
    });
    return transaction.hash;
  }

  try {
    const { escrow } = await getContracts(assetSymbol);
    const transaction = await escrow.refund(escrowId);
    await transaction.wait();
    return transaction.hash;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function openDisputeOnChain(escrowId, assetSymbol = "USDC") {
  const asset = getEscrowAsset(assetSymbol);
  if (isCircleWallet()) {
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "openDispute(string)",
      abiParameters: [escrowId],
    });
    return transaction.hash;
  }
  try {
    const { escrow } = await getContracts(assetSymbol);
    const transaction = await escrow.openDispute(escrowId, { gasLimit: ARC_STATUS_UPDATE_GAS_LIMIT });
    await transaction.wait();
    return transaction.hash;
  } catch (error) {
    // A prior attempt can freeze the escrow on-chain even when saving its
    // evidence afterward fails (oversized file, dropped connection). Retrying
    // then reverts here because the contract is no longer "Funded" or
    // "Delivered". Treat that as success so the caller can save the evidence
    // instead of failing forever with no way to record the dispute.
    if (await isAlreadyDisputedOnChain(escrowId, asset)) return "";
    throw new Error(readableError(error));
  }
}

export async function resolveDisputeOnChain(escrowId, buyerAmount, assetSymbol = "USDC") {
  const asset = getEscrowAsset(assetSymbol);
  const buyerAmountUnits = parseUnits(String(buyerAmount), asset.decimals);
  if (isCircleWallet()) {
    const transaction = await executeCircleProofPay({
      contractAddress: asset.escrowAddress,
      abiFunctionSignature: "resolveDispute(string,uint256)",
      abiParameters: [escrowId, buyerAmountUnits.toString()],
    });
    return transaction.hash;
  }
  try {
    const { escrow } = await getContracts(assetSymbol);
    const transaction = await escrow.resolveDispute(escrowId, buyerAmountUnits, { gasLimit: ARC_ESCROW_GAS_LIMIT });
    await transaction.wait();
    return transaction.hash;
  } catch (error) {
    throw new Error(readableError(error));
  }
}

export async function getEscrowOnChain(escrowId, assetSymbol = "USDC") {
  const asset = getEscrowAsset(assetSymbol);

  try {
    const { escrow } = await getContracts(assetSymbol);
    const result = await escrow.getEscrow(escrowId);

    return {
      buyer: result.buyer,
      seller: result.seller,
      amount: formatUnits(result.amount, asset.decimals),
      status: Number(result.status),
    };
  } catch (error) {
    throw new Error(readableError(error));
  }
}

// These figures are read directly from Arc Testnet. They do not use the
// temporary JSON backend, so the dashboard reflects the deployed contract.
export async function getLiveContractStats() {
  const provider = new JsonRpcProvider(ARC_TESTNET_RPC_URL);
  const balances = await Promise.all(
    ESCROW_ASSETS.map(async (asset) => {
      const token = new Contract(asset.tokenAddress, USDC_ABI, provider);
      const balance = await token.balanceOf(asset.escrowAddress);
      return [asset.symbol, formatUnits(balance, asset.decimals)];
    })
  );

  return { lockedByAsset: Object.fromEntries(balances) };
}
