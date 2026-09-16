import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import pg from "pg";
import { get as getBlob, put as putBlob } from "@vercel/blob";
import { validateCircleConfig } from "./services/circleService.js";

dotenv.config();

validateCircleConfig();

const app = express();

const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://proofpay.online",
  "https://www.proofpay.online",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    const isVercelPreview = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin || "");

    if (!origin || allowedOrigins.includes(origin) || isVercelPreview) {
      callback(null, true);
      return;
    }

    callback(new Error("Origin not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "12mb" }));

const CIRCLE_API_URL = "https://api.circle.com";

const circleHeaders = {
  Authorization: `Bearer ${process.env.CIRCLE_API_KEY}`,
  "Content-Type": "application/json",
};

const escrows = {};
const PENDING_ESCROW_EXPIRY_MS = 12 * 60 * 60 * 1000;
const dataDirectory = process.env.DATA_DIR ||
  (process.env.VERCEL
    ? path.join("/tmp", "proofpay-data")
    : path.join(process.cwd(), "data"));
fs.mkdirSync(dataDirectory, { recursive: true });
const dataFile = path.join(dataDirectory, "escrows.json");
const walletConnectionsFile = path.join(dataDirectory, "wallet-connections.json");
const evidenceDirectory = path.join(dataDirectory, "evidence");
const MAX_EVIDENCE_FILES = 5;
const MAX_EVIDENCE_FILE_BYTES = 2 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
fs.mkdirSync(evidenceDirectory, { recursive: true });
const databasePool = process.env.DATABASE_URL
  ? new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production"
        ? { rejectUnauthorized: false }
        : undefined,
    })
  : null;
let databaseReady;

async function ensureDatabase() {
  if (!databasePool) return;

  if (!databaseReady) {
    databaseReady = databasePool.query(`
      CREATE TABLE IF NOT EXISTS proofpay_records (
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (record_type, record_id)
      )
    `);
  }

  await databaseReady;
}

async function loadEscrows() {
  try {
    let records;

    if (databasePool) {
      await ensureDatabase();
      const result = await databasePool.query(
        "SELECT data FROM proofpay_records WHERE record_type = $1 ORDER BY updated_at ASC",
        ["escrow"]
      );
      records = result.rows.map((row) => row.data);
    } else {
      if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, "[]");
      }
      records = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    }

    if (expirePendingEscrows(records)) {
      await saveEscrows(records);
    }

    return records;

  } catch (error) {

    console.log("Load Error:", error);

    return [];

  }

}

function expirePendingEscrows(records) {
  const now = Date.now();
  let changed = false;

  for (const escrow of records) {
    const isPending =
      escrow.status === "Waiting Seller" ||
      escrow.status === "Seller Accepted";
    const createdAt = Number(escrow.createdAt);

    if (!isPending || !createdAt || now < createdAt + PENDING_ESCROW_EXPIRY_MS) {
      continue;
    }

    escrow.status = "Cancelled";
    escrow.cancellationReason = "Expired after 12 hours";
    escrow.cancelledAt = now;
    escrow.expiresAt = createdAt + PENDING_ESCROW_EXPIRY_MS;
    escrows[escrow.escrowId] = escrow;
    changed = true;
  }

  return changed;
}

async function saveEscrows(data) {
  try {
    if (databasePool) {
      await ensureDatabase();
      const client = await databasePool.connect();

      try {
        await client.query("BEGIN");
        for (const escrow of data) {
          await client.query(
            `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
             VALUES ($1, $2, $3::jsonb, NOW())
             ON CONFLICT (record_type, record_id)
             DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
            ["escrow", escrow.escrowId, JSON.stringify(escrow)]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } else {
      fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.log("❌ SAVE ERROR:", error);
    throw error;
  }
}

function isEscrowParticipant(escrow, wallet) {
  const address = String(wallet || "").toLowerCase();
  return Boolean(address) && [escrow.buyerWallet, escrow.sellerWallet]
    .filter(Boolean)
    .some((participant) => participant.toLowerCase() === address);
}

function participantSide(escrow, wallet) {
  return escrow.buyerWallet?.toLowerCase() === String(wallet || "").toLowerCase()
    ? "buyer"
    : "seller";
}

async function saveEvidenceFiles(escrowId, side, files = []) {
  if (!Array.isArray(files) || files.length > MAX_EVIDENCE_FILES) {
    throw new Error(`Attach up to ${MAX_EVIDENCE_FILES} evidence files.`);
  }
  if (files.length === 0) return [];

  const destination = path.join(evidenceDirectory, escrowId);
  fs.mkdirSync(destination, { recursive: true });

  return Promise.all(files.map(async (file) => {
    if (!ALLOWED_EVIDENCE_TYPES.has(file?.type)) {
      throw new Error("Only JPG, PNG, WEBP, and PDF evidence files are allowed.");
    }
    const match = String(file?.dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match || match[1] !== file.type) throw new Error("Invalid evidence upload.");
    const content = Buffer.from(match[2], "base64");
    if (!content.length || content.length > MAX_EVIDENCE_FILE_BYTES) {
      throw new Error("Each evidence file must be 2 MB or smaller.");
    }
    const id = crypto.randomUUID();
    const extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1];
    let blobUrl = "";
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const blob = await putBlob(`disputes/${escrowId}/${side}/${id}.${extension}`, content, {
        access: "private", contentType: file.type, addRandomSuffix: false,
      });
      blobUrl = blob.url;
    } else {
      fs.writeFileSync(path.join(destination, `${id}.${extension}`), content, { flag: "wx" });
    }
    return {
      id,
      side,
      name: String(file.name || `evidence.${extension}`).slice(0, 120),
      type: file.type,
      size: content.length,
      path: `${id}.${extension}`,
      blobUrl,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
      uploadedAt: Date.now(),
    };
  }));
}

async function loadWalletConnections() {
  try {
    if (databasePool) {
      await ensureDatabase();
      const result = await databasePool.query(
        "SELECT data FROM proofpay_records WHERE record_type = $1 ORDER BY updated_at ASC",
        ["wallet_connection"]
      );
      return result.rows.map((row) => row.data);
    }

    if (!fs.existsSync(walletConnectionsFile)) {
      fs.writeFileSync(walletConnectionsFile, "[]");
    }

    return JSON.parse(fs.readFileSync(walletConnectionsFile, "utf8"));
  } catch (error) {
    console.log("Wallet connection load error:", error);
    return [];
  }
}

async function saveWalletConnections(connections) {
  if (databasePool) {
    await ensureDatabase();
    for (const connection of connections) {
      await databasePool.query(
        `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT (record_type, record_id)
         DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
        ["wallet_connection", connection.address.toLowerCase(), JSON.stringify(connection)]
      );
    }
    return;
  }

  fs.writeFileSync(walletConnectionsFile, JSON.stringify(connections, null, 2));
}

app.post("/api/wallet/connect", async (req, res) => {
  const { address, message, signature, signedAt } = req.body;

  if (!address || !message || !signature || !signedAt) {
    return res.status(400).json({
      success: false,
      message: "Wallet address and signature are required.",
    });
  }

  const connections = await loadWalletConnections();
  const normalizedAddress = address.toLowerCase();
  const connection = {
    address,
    message,
    signature,
    signedAt,
    recordedAt: new Date().toISOString(),
  };
  const existingIndex = connections.findIndex(
    (item) => item.address?.toLowerCase() === normalizedAddress
  );

  if (existingIndex >= 0) {
    connections[existingIndex] = connection;
  } else {
    connections.push(connection);
  }

  await saveWalletConnections(connections);

  return res.json({ success: true, address });
});


app.post("/api/circle/request-email-otp", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const deviceId = String(req.body.deviceId || "").trim();

    if (!email || !deviceId) {
      return res.status(400).json({
        success: false,
        message: "Email and Circle device ID are required.",
      });
    }

    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/users/email/token`,
      {
        idempotencyKey: crypto.randomUUID(),
        deviceId,
        email,
      },
      {
        headers: circleHeaders,
      }
    );

    return res.json(response.data);

  } catch (error) {
    console.error("Circle email OTP error:", error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Circle could not send the verification code.",
      error: error.response?.data || error.message,
    });
  }
});

app.post("/api/circle/initialize-user", async (req, res) => {

  try {

    const userToken = req.get("X-User-Token");

    if (!userToken) {
      return res.status(400).json({
        success: false,
        message: "User token is required",
      });
    }

    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/initialize`,
      {
        idempotencyKey: crypto.randomUUID(),
        accountType: "EOA",
        blockchains: ["ARC-TESTNET"],
      },
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);

  } catch (error) {

    console.log(error.response?.data || error);

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });

  }

});

app.get("/api/circle/wallets", async (req, res) => {
  const userToken = req.get("X-User-Token");

  if (!userToken) {
    return res.status(400).json({
      success: false,
      message: "User token is required.",
    });
  }

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/wallets`,
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
        params: {
          blockchain: "ARC-TESTNET",
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error("Circle wallet lookup error:", error.response?.data || error.message);

    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Circle could not load the wallet.",
      error: error.response?.data || error.message,
    });
  }
});

const PROOFPAY_ESCROW_ADDRESS =
  "0xCd0f43E573899809ff96C560439570A760698C9a";
const ARC_TESTNET_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";
const PROOFPAY_EURC_ESCROW_ADDRESS =
  "0xa4322D8ba3E040A3028FD6ABaC3c6a5625ed4ca7";
const ARC_TESTNET_EURC_ADDRESS =
  "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const PROOFPAY_CIRBTC_ESCROW_ADDRESS =
  "0x8bfeD6F70Eb595946543b192b6E63d75A0bBEf4B";
const ARC_TESTNET_CIRBTC_ADDRESS =
  "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
const escrowFunctions = new Set([
  "createEscrow(string,address,uint256)",
  "confirmDelivery(string)",
  "releaseFunds(string)",
  "refund(string)",
]);
const CIRCLE_CONTRACT_ALLOWLIST = new Map([
  [
    PROOFPAY_ESCROW_ADDRESS.toLowerCase(),
    escrowFunctions,
  ],
  [
    ARC_TESTNET_USDC_ADDRESS.toLowerCase(),
    new Set(["approve(address,uint256)"]),
  ],
  [PROOFPAY_EURC_ESCROW_ADDRESS.toLowerCase(), escrowFunctions],
  [ARC_TESTNET_EURC_ADDRESS.toLowerCase(), new Set(["approve(address,uint256)"])],
  [PROOFPAY_CIRBTC_ESCROW_ADDRESS.toLowerCase(), escrowFunctions],
  [ARC_TESTNET_CIRBTC_ADDRESS.toLowerCase(), new Set(["approve(address,uint256)"])],
]);
const ESCROW_ASSETS = new Map([
  ["USDC", {
    decimals: 6,
    tokenAddress: ARC_TESTNET_USDC_ADDRESS,
    escrowContractAddress: PROOFPAY_ESCROW_ADDRESS,
  }],
  ["EURC", {
    decimals: 6,
    tokenAddress: ARC_TESTNET_EURC_ADDRESS,
    escrowContractAddress: PROOFPAY_EURC_ESCROW_ADDRESS,
  }],
  ["cirBTC", {
    decimals: 8,
    tokenAddress: ARC_TESTNET_CIRBTC_ADDRESS,
    escrowContractAddress: PROOFPAY_CIRBTC_ESCROW_ADDRESS,
  }],
]);

function getCircleUserToken(req, res) {
  const userToken = req.get("X-User-Token");

  if (!userToken) {
    res.status(400).json({
      success: false,
      message: "User token is required.",
    });
    return null;
  }

  return userToken;
}

app.post("/api/circle/contract-execution", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.body.walletId || "").trim();
  const contractAddress = String(req.body.contractAddress || "").trim();
  const abiFunctionSignature = String(
    req.body.abiFunctionSignature || ""
  ).trim();
  const abiParameters = req.body.abiParameters;
  const allowedFunctions = CIRCLE_CONTRACT_ALLOWLIST.get(
    contractAddress.toLowerCase()
  );

  if (
    !walletId ||
    !/^0x[a-fA-F0-9]{40}$/.test(contractAddress) ||
    !allowedFunctions?.has(abiFunctionSignature) ||
    !Array.isArray(abiParameters)
  ) {
    return res.status(400).json({
      success: false,
      message: "This Circle contract operation is not allowed.",
    });
  }

  try {
    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/transactions/contractExecution`,
      {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel: "MEDIUM",
      },
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle contract execution error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not prepare the contract transaction.",
      error: error.response?.data || error.message,
    });
  }
});

app.post("/api/circle/transfer", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.body.walletId || "").trim();
  const destinationAddress = String(
    req.body.destinationAddress || ""
  ).trim();
  const amount = String(req.body.amount || "").trim();
  const tokenId = String(req.body.tokenId || "").trim();

  if (
    !walletId ||
    !/^[a-fA-F0-9-]{36}$/.test(tokenId) ||
    !/^0x[a-fA-F0-9]{40}$/.test(destinationAddress) ||
    !/^\d+(\.\d{1,6})?$/.test(amount) ||
    Number(amount) <= 0
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid Arc address and USDC amount.",
    });
  }

  try {
    const response = await axios.post(
      `${CIRCLE_API_URL}/v1/w3s/user/transactions/transfer`,
      {
        idempotencyKey: crypto.randomUUID(),
        walletId,
        destinationAddress,
        amounts: [amount],
        tokenId,
        feeLevel: "MEDIUM",
      },
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
      }
    );

    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle transfer error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not prepare the USDC transfer.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/wallets/:walletId/balances", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/wallets/${encodeURIComponent(
        req.params.walletId
      )}/balances`,
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
        params: {
          includeAll: true,
          pageSize: 50,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle wallet balances error:",
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load wallet balances.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/transactions", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  const walletId = String(req.query.walletId || "").trim();
  if (!walletId) {
    return res.status(400).json({
      success: false,
      message: "Wallet ID is required.",
    });
  }

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/transactions`,
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
        params: {
          walletIds: walletId,
          includeAll: true,
          pageSize: 20,
          order: "DESC",
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    console.error(
      "Circle wallet activity error:",
      error.response?.data || error.message
    );
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load wallet activity.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/challenges/:challengeId", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/user/challenges/${encodeURIComponent(
        req.params.challengeId
      )}`,
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load the transaction challenge.",
      error: error.response?.data || error.message,
    });
  }
});

app.get("/api/circle/transactions/:transactionId", async (req, res) => {
  const userToken = getCircleUserToken(req, res);
  if (!userToken) return;

  try {
    const response = await axios.get(
      `${CIRCLE_API_URL}/v1/w3s/transactions/${encodeURIComponent(
        req.params.transactionId
      )}`,
      {
        headers: {
          ...circleHeaders,
          "X-User-Token": userToken,
        },
      }
    );
    return res.json(response.data);
  } catch (error) {
    return res.status(error.response?.status || 500).json({
      success: false,
      message:
        error.response?.data?.message ||
        "Circle could not load the transaction.",
      error: error.response?.data || error.message,
    });
  }
});

/*
|--------------------------------------------------------------------------
| Health Check
|--------------------------------------------------------------------------
*/

app.get("/", (req, res) => {
  res.json({
    status: "ProofPay Backend Running 🚀",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    if (databasePool) {
      await databasePool.query("SELECT 1");
    }

    res.json({
      status: "ok",
      service: "proofpay-backend",
      database: databasePool ? "connected" : "local-file",
      network: "Arc Testnet",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      status: "degraded",
      service: "proofpay-backend",
      database: "unavailable",
      message: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/*
|--------------------------------------------------------------------------
| Create Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow", async (req, res) => {
  const assetSymbol = req.body.assetSymbol || "USDC";
  const asset = ESCROW_ASSETS.get(assetSymbol);

  if (!asset) {
    return res.status(400).json({
      success: false,
      message: "Choose USDC, EURC, or cirBTC for this escrow.",
    });
  }

  const escrowId =
    "PP-" +
    Math.random().toString(36).substring(2, 8).toUpperCase();

  const escrow = {
    ...req.body,
    assetSymbol,
    assetDecimals: asset.decimals,
    tokenAddress: asset.tokenAddress,
    escrowContractAddress: asset.escrowContractAddress,
    escrowId,
    status: "Waiting Seller",
    verificationCode: "",

    isPermanent: false,
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_ESCROW_EXPIRY_MS,
  };

  const allEscrows = await loadEscrows();

  allEscrows.push(escrow);

  await saveEscrows(allEscrows);

  escrows[escrowId] = escrow;
  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Get Escrow
|--------------------------------------------------------------------------
*/

app.get("/api/escrow/:id", async (req, res) => {

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (escrow) {
    escrows[req.params.id] = escrow;
  }

  if (!escrow) {

    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });

  }

  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Escrow Status
|--------------------------------------------------------------------------
*/

app.get("/api/escrow/:id/status", async (req, res) => {

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (!escrow) {

    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });

  }

  res.json({
    success: true,
    status: escrow.status,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Seller Accept
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/accept", async (req, res) => {

  const { sellerWallet } = req.body;

  const allEscrows = await loadEscrows();

  const escrow = allEscrows.find(
    (e) => e.escrowId === req.params.id
  );

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (!sellerWallet) {
    return res.status(400).json({
      success: false,
      message: "Seller wallet is required",
    });
  }

  if (escrow.status !== "Waiting Seller") {
    return res.status(400).json({
      success: false,
      message: escrow.status === "Cancelled"
        ? "This escrow request expired after 12 hours."
        : "This escrow request is no longer waiting for seller acceptance.",
    });
  }

  escrow.status = "Seller Accepted";
  escrow.sellerWallet = sellerWallet;
  escrow.sellerVerified = false;
  escrow.sellerVerifiedAt = null;
  escrow.verificationCode = Math.floor(
    100000 + Math.random() * 900000
  ).toString();

  // Keep the in-memory copy in sync with the saved record. The seller
  // verification page reads this copy immediately after acceptance.
  escrows[req.params.id] = escrow;

  await saveEscrows(allEscrows);

  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Seller Verification
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/verify-seller", async (req, res) => {
  const { verificationCode } = req.body || {};
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (escrow.status === "Cancelled") {
    return res.status(400).json({
      success: false,
      message: "This escrow request has been cancelled.",
    });
  }

  if (escrow.sellerVerified) {
    return res.json({ success: true, escrow });
  }

  if (
    !verificationCode ||
    String(verificationCode).trim() !== String(escrow.verificationCode || "")
  ) {
    return res.status(400).json({
      success: false,
      message: "The verification code is incorrect. Please ask the seller to share it again.",
    });
  }

  escrow.sellerVerified = true;
  escrow.sellerVerifiedAt = Date.now();

  await saveEscrows(allEscrows);
  escrows[req.params.id] = escrow;

  return res.json({
    success: true,
    escrow,
  });
});

/*
|--------------------------------------------------------------------------
| Buyer Deposit
|--------------------------------------------------------------------------
*/


app.post("/api/escrow/:id/deposit", async (req, res) => {

  const { transactionHash } = req.body || {};

  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {

    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });

  }

  if (escrow.status === "Cancelled") {
    return res.status(400).json({
      success: false,
      message: "This escrow request expired after 12 hours. Create a new escrow to continue.",
    });
  }

  if (escrow.status !== "Seller Accepted") {
    return res.status(400).json({
      success: false,
      message: "The seller must accept the deal before you can deposit USDC.",
    });
  }

  if (!escrow.sellerVerified) {
    return res.status(400).json({
      success: false,
      message: "Verify the seller before depositing USDC.",
    });
  }

  escrow.status = "Funds Locked";
  escrow.isPermanent = true;
  escrow.depositedAt = Date.now();

  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.depositTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {

    allEscrows[index] = escrow;

    await saveEscrows(allEscrows);

  }

  escrows[req.params.id] = escrow;

  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Seller Delivery Complete
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/delivered", async (req, res) => {
  const { transactionHash } = req.body || {};
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  escrow.status = "Delivered";
  escrow.deliveredAt = Date.now();

  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.deliveryTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {

    allEscrows[index] = escrow;

    await saveEscrows(allEscrows);

  }

  res.json({
    success: true,
    escrow,
  });

});

/*
|--------------------------------------------------------------------------
| Buyer Release Funds
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/release", async (req, res) => {

  const { transactionHash } = req.body || {};

  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {

    return res.status(404).json({

      success: false,
      message: "Escrow Not Found",

    });

  }


  if (escrow.status !== "Delivered") {

    return res.status(400).json({
      success: false,
      message: "Seller has not marked the order as Delivered.",
    });

  }

  escrow.status = "Released";
  escrow.releasedAt = Date.now();

  if (/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) {
    escrow.releaseTransactionHash = transactionHash;
  }

  const index = allEscrows.findIndex(
    (e) => e.escrowId === escrow.escrowId
  );

  if (index !== -1) {

    allEscrows[index] = escrow;

    await saveEscrows(allEscrows);

  }

  res.json({

    success: true,
    escrow,

  });

});

/*
|--------------------------------------------------------------------------
| Disputes and private evidence
|--------------------------------------------------------------------------
*/
app.post("/api/escrow/:id/dispute", async (req, res) => {
  try {
    const { wallet, reason, statement, files, transactionHash } = req.body || {};
    const allEscrows = await loadEscrows();
    const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
    if (!escrow) return res.status(404).json({ success: false, message: "Escrow Not Found" });
    if (!isEscrowParticipant(escrow, wallet)) return res.status(403).json({ success: false, message: "Only the buyer or seller can open this dispute." });
    if (!["Funds Locked", "Delivered"].includes(escrow.status)) {
      return res.status(400).json({ success: false, message: "Only funded escrows can be disputed." });
    }
    if (!String(reason || "").trim() || !String(statement || "").trim()) {
      return res.status(400).json({ success: false, message: "A dispute reason and explanation are required." });
    }

    const side = participantSide(escrow, wallet);
    const evidence = await saveEvidenceFiles(escrow.escrowId, side, files);
    escrow.status = "Disputed";
    escrow.dispute = {
      id: crypto.randomUUID(),
      openedBy: String(wallet).toLowerCase(),
      openedBySide: side,
      reason: String(reason).trim().slice(0, 120),
      statement: String(statement).trim().slice(0, 4000),
      openedAt: Date.now(),
      responseDueAt: Date.now() + 48 * 60 * 60 * 1000,
      status: "Awaiting response",
      openTransactionHash: /^0x[a-fA-F0-9]{64}$/.test(transactionHash || "") ? transactionHash : "",
      evidence,
      responses: [],
    };
    await saveEscrows(allEscrows);
    escrows[escrow.escrowId] = escrow;
    return res.json({ success: true, escrow });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to open dispute." });
  }
});

app.post("/api/escrow/:id/dispute/response", async (req, res) => {
  try {
    const { wallet, statement, files } = req.body || {};
    const allEscrows = await loadEscrows();
    const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
    if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });
    if (!isEscrowParticipant(escrow, wallet)) return res.status(403).json({ success: false, message: "Only escrow participants can respond." });
    const side = participantSide(escrow, wallet);
    if (side === escrow.dispute.openedBySide) return res.status(400).json({ success: false, message: "Wait for the other party's response before adding more evidence." });
    if (!String(statement || "").trim()) return res.status(400).json({ success: false, message: "A written response is required." });
    const evidence = await saveEvidenceFiles(escrow.escrowId, side, files);
    escrow.dispute.responses.push({ side, wallet: String(wallet).toLowerCase(), statement: String(statement).trim().slice(0, 4000), submittedAt: Date.now(), evidence });
    escrow.dispute.status = "Under review";
    await saveEscrows(allEscrows);
    return res.json({ success: true, escrow });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || "Unable to submit response." });
  }
});

app.get("/api/escrow/:id/dispute", async (req, res) => {
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute) return res.status(404).json({ success: false, message: "Dispute not found." });
  if (!isEscrowParticipant(escrow, req.query.wallet)) return res.status(403).json({ success: false, message: "This case is private." });
  return res.json({ success: true, dispute: escrow.dispute, escrow });
});

app.get("/api/escrow/:id/dispute/evidence/:fileId", async (req, res) => {
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || (!isEscrowParticipant(escrow, req.query.wallet) && !isDisputeAdmin(req.query.wallet))) return res.sendStatus(403);
  const entries = [...escrow.dispute.evidence, ...escrow.dispute.responses.flatMap((response) => response.evidence || [])];
  const file = entries.find((entry) => entry.id === req.params.fileId);
  if (!file) return res.sendStatus(404);
  if (file.blobUrl) {
    const blob = await getBlob(file.blobUrl, { access: "private" });
    if (!blob?.stream) return res.sendStatus(404);
    const content = Buffer.from(await new Response(blob.stream).arrayBuffer());
    return res.type(file.type).send(content);
  }
  return res.type(file.type).sendFile(path.resolve(evidenceDirectory, escrow.escrowId, file.path));
});

function isDisputeAdmin(wallet) {
  const configured = String(process.env.DISPUTE_ADMIN_WALLET || "").toLowerCase();
  return Boolean(configured) && configured === String(wallet || "").toLowerCase();
}

app.get("/api/admin/disputes", async (req, res) => {
  if (!isDisputeAdmin(req.query.wallet)) return res.status(403).json({ success: false, message: "ProofPay admin access required." });
  const allEscrows = await loadEscrows();
  const withDispute = allEscrows.filter((escrow) => escrow.dispute);
  return res.json({
    success: true,
    disputes: withDispute.filter((escrow) => escrow.status === "Disputed"),
    resolved: withDispute
      .filter((escrow) => escrow.dispute.resolution)
      .sort((a, b) => b.dispute.resolution.resolvedAt - a.dispute.resolution.resolvedAt),
  });
});

app.post("/api/admin/disputes/:id/resolved", async (req, res) => {
  const { wallet, buyerAmount, transactionHash, note } = req.body || {};
  if (!isDisputeAdmin(wallet)) return res.status(403).json({ success: false, message: "ProofPay admin access required." });
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash || "")) return res.status(400).json({ success: false, message: "A confirmed on-chain resolution transaction is required." });
  if (!String(note || "").trim()) return res.status(400).json({ success: false, message: "Explain the resolution so both sides can see the reasoning." });
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);
  if (!escrow?.dispute || escrow.status !== "Disputed") return res.status(404).json({ success: false, message: "Active dispute not found." });
  escrow.status = Number(buyerAmount) >= Number(escrow.amount) ? "Refunded" : "Released";
  escrow.dispute.status = "Resolved";
  escrow.dispute.resolution = {
    buyerAmount: String(buyerAmount),
    sellerAmount: String(Number(escrow.amount) - Number(buyerAmount)),
    transactionHash,
    note: String(note).trim().slice(0, 2000),
    resolvedAt: Date.now(),
    resolvedBy: String(wallet).toLowerCase(),
  };
  await saveEscrows(allEscrows);
  return res.json({ success: true, escrow });
});

/*
|--------------------------------------------------------------------------
| Cancel Pending Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/cancel", async (req, res) => {
  const { buyerWallet } = req.body;
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({
      success: false,
      message: "Escrow Not Found",
    });
  }

  if (
    escrow.status !== "Waiting Seller" &&
    escrow.status !== "Seller Accepted"
  ) {
    return res.status(400).json({
      success: false,
      message: "Only an escrow that has not been funded can be cancelled.",
    });
  }

  if (
    buyerWallet &&
    escrow.buyerWallet &&
    buyerWallet.toLowerCase() !== escrow.buyerWallet.toLowerCase()
  ) {
    return res.status(403).json({
      success: false,
      message: "Only the buyer wallet can cancel this escrow.",
    });
  }

  escrow.status = "Cancelled";
  escrow.cancellationReason = "Cancelled by Buyer";
  escrow.cancelledAt = Date.now();
  escrows[req.params.id] = escrow;
  await saveEscrows(allEscrows);

  return res.json({ success: true, escrow });
});

/*
|--------------------------------------------------------------------------
| Seller Reject Escrow
|--------------------------------------------------------------------------
*/

app.post("/api/escrow/:id/reject", async (req, res) => {
  const { sellerWallet } = req.body;
  const allEscrows = await loadEscrows();
  const escrow = allEscrows.find((item) => item.escrowId === req.params.id);

  if (!escrow) {
    return res.status(404).json({ success: false, message: "Escrow Not Found" });
  }

  if (escrow.status !== "Waiting Seller" && escrow.status !== "Seller Accepted") {
    return res.status(400).json({
      success: false,
      message: "This escrow can no longer be rejected.",
    });
  }

  escrow.status = "Cancelled";
  escrow.cancellationReason = "Rejected by Seller";
  escrow.sellerWallet = sellerWallet || escrow.sellerWallet || "";
  escrow.cancelledAt = Date.now();
  escrows[req.params.id] = escrow;
  await saveEscrows(allEscrows);

  return res.json({ success: true, escrow });
});

/*
|--------------------------------------------------------------------------
| Get Active Escrows
|--------------------------------------------------------------------------
*/

app.get("/api/escrows", async (req, res) => {

  const allEscrows = await loadEscrows();

  const { category, buyerWallet, wallet, role } = req.query;
  const categories = {
    pending: ["Waiting Seller", "Seller Accepted"],
    active: ["Funds Locked", "Delivered", "Disputed"],
    completed: ["Released", "Refunded"],
    cancelled: ["Cancelled"],
  };

  const allowedStatuses = categories[category] || categories.active;
  const connectedWallet = (wallet || buyerWallet || "").toLowerCase();
  const recordRole = role === "seller" ? "seller" : "buyer";

  const activeEscrows = allEscrows.filter((escrow) => {
    const belongsToConnectedWallet = !connectedWallet || (
      recordRole === "seller"
        ? escrow.sellerWallet?.toLowerCase() === connectedWallet
        : escrow.buyerWallet?.toLowerCase() === connectedWallet
    );

    if (!belongsToConnectedWallet) return false;
    if (category === "disputes") return Boolean(escrow.dispute);
    return allowedStatuses.includes(escrow.status);
  });

  res.json({
    success: true,
    escrows: activeEscrows,
  });

});

/*
|--------------------------------------------------------------------------
| ProofPay Live Escrow Overview
|--------------------------------------------------------------------------
*/

app.get("/api/escrow-stats", async (req, res) => {
  const allEscrows = await loadEscrows();
  const lockedEscrows = allEscrows.filter(
    (escrow) => escrow.status === "Funds Locked" || escrow.status === "Delivered"
  );
  const executedEscrows = allEscrows.filter((escrow) =>
    ["Funds Locked", "Delivered", "Released"].includes(escrow.status)
  ).length;

  const lockedByAsset = lockedEscrows.reduce((totals, escrow) => {
    const symbol = ESCROW_ASSETS.has(escrow.assetSymbol) ? escrow.assetSymbol : "USDC";
    totals[symbol] += Number(escrow.amount) || 0;
    return totals;
  }, { USDC: 0, EURC: 0, cirBTC: 0 });
  const activeBuyers = new Set(
    allEscrows.map((escrow) => escrow.buyerWallet?.toLowerCase()).filter(Boolean)
  ).size;
  const activeSellers = new Set(
    allEscrows.map((escrow) => escrow.sellerWallet?.toLowerCase()).filter(Boolean)
  ).size;

  return res.json({
    success: true,
    lockedByAsset,
    executedEscrows,
    liveEscrows: allEscrows.length,
    activeBuyers,
    activeSellers,
  });
});

/*
|--------------------------------------------------------------------------
| Start Server
|--------------------------------------------------------------------------
*/

const PORT = Number(process.env.PORT) || 5001;

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {

    console.log(
      `✅ ProofPay Backend Running on http://localhost:${PORT}`
    );

  });
}

export default app;
