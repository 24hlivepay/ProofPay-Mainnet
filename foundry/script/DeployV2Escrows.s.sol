// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {ProofPayEscrowV2} from "../src/ProofPayEscrowV2.sol";

interface IERC20Meta {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

// Deploys the two ProofPayEscrowV2 contracts (USDC and EURC) on ONE Arc network.
// It picks the token addresses from the chain id it is pointed at, and refuses
// to run on any other chain, so a wrong --rpc-url cannot deploy the wrong thing.
//
// Read-only dry run (sends nothing):
//   forge script script/DeployV2Escrows.s.sol --rpc-url <RPC>
// Real deploy (signs with the deployer keystore; only the owner runs this):
//   forge script script/DeployV2Escrows.s.sol --rpc-url <RPC> \
//     --account proofpay-deployer --sender <deployer address> --broadcast
//
// The deployer becomes the owner of both contracts. Hand the owner role over
// afterwards with transferOwnership + acceptOwnership on EACH contract.
contract DeployV2Escrows is Script {
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;

    // USDC's ERC-20 interface lives at this address on both Arc networks.
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    // Verified against Circle's Arc docs (docs.arc.io/arc/references/contract-addresses)
    // for mainnet; the testnet address is the one the v1 testnet escrow uses.
    address internal constant ARC_MAINNET_EURC = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address internal constant ARC_TESTNET_EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;

    function run() external returns (ProofPayEscrowV2 usdcEscrow, ProofPayEscrowV2 eurcEscrow) {
        address eurc;
        if (block.chainid == ARC_MAINNET_CHAIN_ID) {
            eurc = ARC_MAINNET_EURC;
        } else if (block.chainid == ARC_TESTNET_CHAIN_ID) {
            eurc = ARC_TESTNET_EURC;
        } else {
            revert("Unknown chain: expected Arc mainnet (5042) or Arc testnet (5042002)");
        }

        _checkToken(ARC_USDC, "USDC");
        _checkToken(eurc, "EURC");

        vm.startBroadcast();
        usdcEscrow = new ProofPayEscrowV2(ARC_USDC);
        eurcEscrow = new ProofPayEscrowV2(eurc);
        vm.stopBroadcast();

        // Post-deploy sanity checks: each contract points at the right token,
        // both have the same non-zero owner, and nothing starts paused.
        require(address(usdcEscrow.usdc()) == ARC_USDC, "USDC escrow points at the wrong token");
        require(address(eurcEscrow.usdc()) == eurc, "EURC escrow points at the wrong token");
        address owner = usdcEscrow.owner();
        require(owner != address(0) && owner == eurcEscrow.owner(), "Owner mismatch");
        require(usdcEscrow.pendingOwner() == address(0) && eurcEscrow.pendingOwner() == address(0), "Unexpected pending owner");
        require(!usdcEscrow.paused() && !eurcEscrow.paused(), "Unexpectedly paused");

        console2.log("CHAIN_ID", block.chainid);
        console2.log("OWNER", owner);
        console2.log("USDC_ESCROW_V2_ADDRESS", address(usdcEscrow));
        console2.log("EURC_ESCROW_V2_ADDRESS", address(eurcEscrow));
    }

    // The address must be a contract, be a 6-decimal token, and call itself the
    // expected symbol. Catches a typo'd address or the wrong network's token.
    function _checkToken(address token, string memory expectedSymbol) internal view {
        require(token.code.length > 0, string.concat(expectedSymbol, ": no contract at this address on this chain"));
        require(IERC20Meta(token).decimals() == 6, string.concat(expectedSymbol, ": decimals is not 6"));
        require(
            keccak256(bytes(IERC20Meta(token).symbol())) == keccak256(bytes(expectedSymbol)),
            string.concat(expectedSymbol, ": symbol does not match")
        );
    }
}
