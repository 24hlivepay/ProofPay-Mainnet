// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ProofPayEscrow.sol";

contract DeployProofPayEscrow is Script {
    // Native USDC is the same address on Arc Mainnet and Testnet (Circle docs:
    // docs.arc.io/arc/references/contract-addresses) — verified, not assumed.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (ProofPayEscrow escrow) {
        vm.startBroadcast();
        escrow = new ProofPayEscrow(ARC_USDC);
        vm.stopBroadcast();
    }
}
