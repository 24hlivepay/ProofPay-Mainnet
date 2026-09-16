import fs from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import type { InterfaceAbi } from "ethers";

// Verified against Circle's official Arc Mainnet docs (docs.arc.io/arc/references/contract-addresses).
const ARC_MAINNET_EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
// cirBTC has no documented Arc Mainnet contract as of the mainnet launch (Sept 2026).
// It only exists in Circle's docs as a testnet asset. Deploying a CIRBTC escrow here
// is disabled until Circle publishes a mainnet cirBTC address — see the check below.
const ARC_MAINNET_CIRBTC = "";
const EXPECTED_DEPLOYER = "0xd979e5d9eeb1126c75a7b215ee0f79895fe091ac"; // Same deployer wallet as testnet, reused intentionally for Mainnet.

type Artifact = {
  abi: InterfaceAbi;
  bytecode: string;
};

async function deployAssetEscrow(
  factory: ContractFactory,
  symbol: string,
  tokenAddress: string
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const escrow = await factory.deploy(tokenAddress);
      await escrow.waitForDeployment();

      const address = await escrow.getAddress();
      console.log(`${symbol}_ESCROW_ADDRESS=${address}`);
      return address;
    } catch (error) {
      lastError = error;
      const message = String(
        (error as { error?: { message?: string }; message?: string })?.error?.message ||
        (error as { message?: string })?.message ||
        ""
      ).toLowerCase();

      if (!message.includes("request limit reached") || attempt === 4) {
        throw error;
      }

      const delayMs = 4_000 * (attempt + 1);
      console.log(`Arc RPC rate limit reached. Retrying ${symbol} in ${delayMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;

  if (!rpcUrl || !privateKey) {
    throw new Error("RPC_URL and PRIVATE_KEY are required.");
  }

  const artifactPath = path.join(
    process.cwd(),
    "artifacts/contracts/ProofPayEscrow.sol/ProofPayEscrow.json"
  );
  const artifact = JSON.parse(
    fs.readFileSync(artifactPath, "utf8")
  ) as Artifact;
  const provider = new JsonRpcProvider(rpcUrl);
  const deployer = new Wallet(privateKey, provider);

  if (deployer.address.toLowerCase() !== EXPECTED_DEPLOYER) {
    throw new Error(
      `Wrong deployer wallet: ${deployer.address}. Expected ${EXPECTED_DEPLOYER}.`
    );
  }

  console.log("DEPLOYER_ADDRESS=" + deployer.address);
  const factory = new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    deployer
  );
  const requestedAsset = (process.env.DEPLOY_ASSET || "ALL").toUpperCase();

  if (requestedAsset === "ALL" || requestedAsset === "EURC") {
    await deployAssetEscrow(factory, "EURC", ARC_MAINNET_EURC);
  }
  if (requestedAsset === "CIRBTC" || requestedAsset === "ALL") {
    if (!ARC_MAINNET_CIRBTC) {
      if (requestedAsset === "CIRBTC") {
        throw new Error(
          "No Arc Mainnet cirBTC contract is published yet. Set ARC_MAINNET_CIRBTC once Circle documents one."
        );
      }
      console.log("Skipping CIRBTC: no Arc Mainnet cirBTC contract published yet.");
    } else {
      await deployAssetEscrow(factory, "CIRBTC", ARC_MAINNET_CIRBTC);
    }
  }

  if (!["ALL", "EURC", "CIRBTC"].includes(requestedAsset)) {
    throw new Error("DEPLOY_ASSET must be ALL, EURC, or CIRBTC.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
