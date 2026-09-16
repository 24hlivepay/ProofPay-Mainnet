// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import "../src/ProofPayEscrow.sol";

contract DeployAssetEscrows is Script {
    address internal constant ARC_TESTNET_EURC =
        0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address internal constant ARC_TESTNET_CIRBTC =
        0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;

    function run()
        external
        returns (ProofPayEscrow eurcEscrow, ProofPayEscrow cirBtcEscrow)
    {
        vm.startBroadcast();
        eurcEscrow = new ProofPayEscrow(ARC_TESTNET_EURC);
        cirBtcEscrow = new ProofPayEscrow(ARC_TESTNET_CIRBTC);
        vm.stopBroadcast();

        console2.log("EURC_ESCROW_ADDRESS", address(eurcEscrow));
        console2.log("CIRBTC_ESCROW_ADDRESS", address(cirBtcEscrow));
    }
}
