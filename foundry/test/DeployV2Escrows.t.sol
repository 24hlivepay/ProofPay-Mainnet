// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {DeployV2Escrows} from "../script/DeployV2Escrows.s.sol";

// The real safety net is the read-only dry run against the live networks (see
// the header of the script). These tests cover the guard that needs no network.
contract DeployV2EscrowsTest is Test {
    function testRefusesToRunOnAnUnknownChain() public {
        DeployV2Escrows deployer = new DeployV2Escrows();
        vm.chainId(1);
        vm.expectRevert("Unknown chain: expected Arc mainnet (5042) or Arc testnet (5042002)");
        deployer.run();
    }

    function testRefusesWhenTheTokenIsMissing() public {
        DeployV2Escrows deployer = new DeployV2Escrows();
        // Right chain id, but this local chain has no token at the USDC address.
        vm.chainId(5042);
        vm.expectRevert("USDC: no contract at this address on this chain");
        deployer.run();
    }
}
