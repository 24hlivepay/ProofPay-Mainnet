// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofPayEscrow} from "../src/ProofPayEscrow.sol";

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address account, uint256 amount) external {
        balanceOf[account] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ProofPayEscrowTest is Test {
    uint256 private constant AMOUNT = 100e6;
    string private constant ESCROW_ID = "PP-TEST01";

    MockToken private token;
    ProofPayEscrow private escrow;
    address private buyer = makeAddr("buyer");
    address private seller = makeAddr("seller");
    address private outsider = makeAddr("outsider");

    function setUp() public {
        token = new MockToken();
        escrow = new ProofPayEscrow(address(token));
        token.mint(buyer, AMOUNT * 3);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _createEscrow() private {
        vm.prank(buyer);
        escrow.createEscrow(ESCROW_ID, seller, AMOUNT);
    }

    function testCreateEscrowLocksFundsAndStoresParticipants() public {
        _createEscrow();

        (address storedBuyer, address storedSeller, uint256 amount, ProofPayEscrow.Status status) =
            escrow.getEscrow(ESCROW_ID);
        assertEq(storedBuyer, buyer);
        assertEq(storedSeller, seller);
        assertEq(amount, AMOUNT);
        assertEq(uint256(status), uint256(ProofPayEscrow.Status.Funded));
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testHappyPathReleasesFundsOnlyAfterSellerDelivery() public {
        _createEscrow();
        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.prank(buyer);
        escrow.releaseFunds(ESCROW_ID);

        (, , , ProofPayEscrow.Status status) = escrow.getEscrow(ESCROW_ID);
        assertEq(uint256(status), uint256(ProofPayEscrow.Status.Released));
        assertEq(token.balanceOf(seller), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testBuyerCanRefundBeforeDelivery() public {
        _createEscrow();
        uint256 balanceBefore = token.balanceOf(buyer);
        vm.prank(buyer);
        escrow.refund(ESCROW_ID);

        (, , , ProofPayEscrow.Status status) = escrow.getEscrow(ESCROW_ID);
        assertEq(uint256(status), uint256(ProofPayEscrow.Status.Refunded));
        assertEq(token.balanceOf(buyer), balanceBefore + AMOUNT);
    }

    function testParticipantCanOpenDisputeAndOwnerCanSplitFunds() public {
        _createEscrow();
        vm.prank(seller);
        escrow.openDispute(ESCROW_ID);
        escrow.resolveDispute(ESCROW_ID, 40e6);

        assertEq(token.balanceOf(buyer), AMOUNT * 2 + 40e6);
        assertEq(token.balanceOf(seller), 60e6);
    }

    function testOnlySellerCanConfirmDelivery() public {
        _createEscrow();
        vm.expectRevert("Only seller can confirm delivery");
        vm.prank(outsider);
        escrow.confirmDelivery(ESCROW_ID);
    }

    function testOnlyBuyerCanReleaseFunds() public {
        _createEscrow();
        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.expectRevert("Only buyer can release funds");
        vm.prank(seller);
        escrow.releaseFunds(ESCROW_ID);
    }

    function testCannotReleaseBeforeDelivery() public {
        _createEscrow();
        vm.expectRevert("Delivery is not confirmed");
        vm.prank(buyer);
        escrow.releaseFunds(ESCROW_ID);
    }

    function testOutsiderCannotOpenDispute() public {
        _createEscrow();
        vm.expectRevert("Only participants can dispute");
        vm.prank(outsider);
        escrow.openDispute(ESCROW_ID);
    }

    function testOnlyOwnerCanResolveDispute() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);
        vm.expectRevert("Only owner");
        vm.prank(outsider);
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
    }

    function testCannotCreateDuplicateEscrowId() public {
        _createEscrow();
        vm.expectRevert("Escrow already exists");
        vm.prank(buyer);
        escrow.createEscrow(ESCROW_ID, seller, AMOUNT);
    }

    function testRejectsInvalidEscrowInputs() public {
        vm.startPrank(buyer);
        vm.expectRevert("Escrow ID is required");
        escrow.createEscrow("", seller, AMOUNT);
        vm.expectRevert("Invalid seller");
        escrow.createEscrow("PP-ZERO", address(0), AMOUNT);
        vm.expectRevert("Invalid seller");
        escrow.createEscrow("PP-SELF", buyer, AMOUNT);
        vm.expectRevert("Amount must be greater than zero");
        escrow.createEscrow("PP-AMOUNT", seller, 0);
        vm.stopPrank();
    }

    function testDisputeResolutionCannotExceedLockedAmount() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);
        vm.expectRevert("Invalid buyer amount");
        escrow.resolveDispute(ESCROW_ID, AMOUNT + 1);
    }
}
