import hre from "hardhat";

const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

async function main() {
  const usdcAddress = process.env.USDC_ADDRESS || ARC_TESTNET_USDC;
  const ProofPayEscrow = await hre.ethers.getContractFactory("ProofPayEscrow");
  const proofPayEscrow = await ProofPayEscrow.deploy(usdcAddress);

  await proofPayEscrow.waitForDeployment();

  const address = await proofPayEscrow.getAddress();

  console.log("ProofPayEscrow deployed to:", address);
  console.log("USDC token:", usdcAddress);
  console.log(`Add this to frontend/.env: VITE_PROOFPAY_ESCROW_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
