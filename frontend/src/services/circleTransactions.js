import api from "./api";
import { executeCircleChallenge } from "../circle/circleConfig";
import { getCircleAuthSession } from "./wallet";

const SUCCESS_STATES = new Set(["COMPLETE", "CONFIRMED"]);
const FAILURE_STATES = new Set(["CANCELLED", "DENIED", "FAILED"]);

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function getCircleSession() {
  let auth;
  let wallet;

  try {
    auth = getCircleAuthSession();
    wallet = JSON.parse(
      localStorage.getItem("proofpay-wallet-session") || "null"
    );
  } catch {
    auth = null;
    wallet = null;
  }

  if (
    !auth?.userToken ||
    !auth?.encryptionKey ||
    !wallet?.walletId ||
    wallet?.walletType !== "circle"
  ) {
    throw new Error(
      "Your Circle wallet session has expired. Sign in with email again, then retry."
    );
  }

  return { auth, wallet };
}

async function getTransactionId(challengeId, userToken) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await api.get(`/circle/challenges/${challengeId}`, {
      headers: { "X-User-Token": userToken },
    });
    const challenge = response.data.data?.challenge;
    const transactionId = challenge?.correlationIds?.[0];

    if (transactionId) return transactionId;
    if (challenge?.status === "FAILED" || challenge?.status === "EXPIRED") {
      throw new Error(
        challenge.errorMessage ||
          `Circle transaction approval ended with status: ${challenge.status}.`
      );
    }
    await wait(1000);
  }

  throw new Error("Circle approved the request but did not return a transaction.");
}

async function waitForTransaction(transactionId, userToken) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await api.get(`/circle/transactions/${transactionId}`, {
      headers: { "X-User-Token": userToken },
    });
    const transaction = response.data.data?.transaction;

    if (SUCCESS_STATES.has(transaction?.state) && transaction?.txHash) {
      return transaction;
    }
    if (FAILURE_STATES.has(transaction?.state)) {
      throw new Error(
        transaction.errorReason ||
          `Circle transaction ended with status: ${transaction.state}.`
      );
    }
    await wait(1500);
  }

  throw new Error(
    "The Circle transaction is still processing. Check the wallet activity before retrying."
  );
}

export async function executeCircleContract({
  contractAddress,
  abiFunctionSignature,
  abiParameters,
  onSubmitted,
  display,
}) {
  const { auth, wallet } = getCircleSession();
  const response = await api.post(
    "/circle/contract-execution",
    {
      walletId: wallet.walletId,
      contractAddress,
      abiFunctionSignature,
      abiParameters,
    },
    {
      headers: { "X-User-Token": auth.userToken },
    }
  );
  const challengeId = response.data.data?.challengeId;

  if (!challengeId) {
    throw new Error("Circle did not return a transaction approval request.");
  }

  await executeCircleChallenge({
    challengeId,
    userToken: auth.userToken,
    encryptionKey: auth.encryptionKey,
    display,
  });

  const transactionId = await getTransactionId(challengeId, auth.userToken);
  onSubmitted?.(transactionId);
  const transaction = await waitForTransaction(
    transactionId,
    auth.userToken
  );

  return {
    hash: transaction.txHash,
    transactionId,
  };
}

export async function sendCircleToken({
  destinationAddress,
  amount,
  tokenId,
  onSubmitted,
}) {
  const { auth, wallet } = getCircleSession();
  const response = await api.post(
    "/circle/transfer",
    {
      walletId: wallet.walletId,
      destinationAddress,
      amount,
      tokenId,
    },
    {
      headers: { "X-User-Token": auth.userToken },
    }
  );
  const challengeId = response.data.data?.challengeId;

  if (!challengeId) {
    throw new Error("Circle did not return a transfer approval request.");
  }

  await executeCircleChallenge({
    challengeId,
    userToken: auth.userToken,
    encryptionKey: auth.encryptionKey,
  });

  const transactionId = await getTransactionId(challengeId, auth.userToken);
  onSubmitted?.(transactionId);
  const transaction = await waitForTransaction(
    transactionId,
    auth.userToken
  );

  return {
    hash: transaction.txHash,
    transactionId,
  };
}
