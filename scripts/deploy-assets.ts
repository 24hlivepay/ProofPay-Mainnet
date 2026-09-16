import fs from "node:fs";
import path from "node:path";
import { ContractFactory, JsonRpcProvider, Wallet } from "ethers";
import type { InterfaceAbi } from "ethers";

const ARC_TESTNET_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const ARC_TESTNET_CIRBTC = "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF";
const EXPECTED_DEPLOYER = "0xd979e5d9eeb1126c75a7b215ee0f79895fe091ac";

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
    await deployAssetEscrow(factory, "EURC", ARC_TESTNET_EURC);
  }
  if (requestedAsset === "ALL" || requestedAsset === "CIRBTC") {
    await deployAssetEscrow(factory, "CIRBTC", ARC_TESTNET_CIRBTC);
  }

  if (!["ALL", "EURC", "CIRBTC"].includes(requestedAsset)) {
    throw new Error("DEPLOY_ASSET must be ALL, EURC, or CIRBTC.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
