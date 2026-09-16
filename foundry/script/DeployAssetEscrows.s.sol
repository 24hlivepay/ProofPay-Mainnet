// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ProofPayEscrow.sol";

contract DeployAssetEscrows is Script {
    // Verified against Circle's official Arc Mainnet docs
    // (docs.arc.io/arc/references/contract-addresses).
    address internal constant ARC_MAINNET_EURC =
        0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    // cirBTC has no documented Arc Mainnet contract as of the mainnet launch
    // (Sept 2026) — it only appears in Circle's testnet docs. This script no
    // longer deploys a cirBTC escrow until Circle publishes a mainnet address;
    // use DeployProofPayEscrow-style deployment for it once one exists.

    function run() external returns (ProofPayEscrow eurcEscrow) {
        vm.startBroadcast();
        eurcEscrow = new ProofPayEscrow(ARC_MAINNET_EURC);
        vm.stopBroadcast();

        console2.log("EURC_ESCROW_ADDRESS", address(eurcEscrow));
    }
}
