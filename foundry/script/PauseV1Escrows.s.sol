// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";

interface IPausableEscrow {
    function owner() external view returns (address);
    function paused() external view returns (bool);
    function pause() external;
}

// Pauses the deployed v1 ProofPayEscrow contracts on Arc MAINNET, so no NEW
// escrow can be created on them. The v1 TESTNET contracts were deployed before
// pause() was added to the code and have no pause function at all, so this script
// refuses to run on testnet (they are retired by removing them from the app config). It does not touch escrows that already exist
// (v1 pause only blocks createEscrow; release, dispute and resolve keep working).
// It picks the addresses from the chain id, refuses any other chain, only sends a
// pause() to contracts that are not already paused, and checks the result.
//
// Read-only dry run (sends nothing):
//   forge script script/PauseV1Escrows.s.sol --rpc-url <RPC> --sender <owner address>
// Real run (signs with the owner's keystore; only the owner runs this):
//   forge script script/PauseV1Escrows.s.sol --rpc-url <RPC> \
//     --account proofpay-deployer --sender <owner address> --broadcast
contract PauseV1Escrows is Script {
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    function run() external {
        address[] memory targets = _targets();

        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i].code.length > 0, "No contract at a v1 address on this chain");
        }

        vm.startBroadcast();
        (, address sender, ) = vm.readCallers();
        for (uint256 i = 0; i < targets.length; i++) {
            IPausableEscrow escrow = IPausableEscrow(targets[i]);
            require(escrow.owner() == sender, "Sender is not the owner of a v1 contract");
            if (!escrow.paused()) {
                escrow.pause();
            }
        }
        vm.stopBroadcast();

        for (uint256 i = 0; i < targets.length; i++) {
            require(IPausableEscrow(targets[i]).paused(), "A v1 contract is still not paused");
            console2.log("PAUSED", targets[i]);
        }
        console2.log("CHAIN_ID", block.chainid);
    }

    function _targets() internal view returns (address[] memory targets) {
        if (block.chainid == ARC_MAINNET_CHAIN_ID) {
            targets = new address[](2);
            targets[0] = 0x626B2731A11B39A782992B57ED102012b607BC79; // USDC
            targets[1] = 0xF6f0178e40dbF82D79e7E90a9b07AB0f32b862C0; // EURC
        } else if (block.chainid == ARC_TESTNET_CHAIN_ID) {
            revert("The v1 testnet contracts have no pause(); nothing to do on testnet");
        } else {
            revert("Unknown chain: expected Arc mainnet (5042)");
        }
    }
}
