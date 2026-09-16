// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ProofPayEscrow.sol";

contract DeployProofPayEscrow is Script {
    address internal constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (ProofPayEscrow escrow) {
        vm.startBroadcast();
        escrow = new ProofPayEscrow(ARC_TESTNET_USDC);
        vm.stopBroadcast();
    }
}
