// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ProofPayEscrowV2} from "../src/ProofPayEscrowV2.sol";

contract MockTokenV2 {
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

contract ProofPayEscrowV2Test is Test {
    uint256 private constant AMOUNT = 100e6;
    string private constant ESCROW_ID = "PP-TEST01";

    MockTokenV2 private token;
    ProofPayEscrowV2 private escrow;
    address private buyer = makeAddr("buyer");
    address private seller = makeAddr("seller");
    address private outsider = makeAddr("outsider");
    address private newOwner = makeAddr("newOwner");

    function setUp() public {
        token = new MockTokenV2();
        escrow = new ProofPayEscrowV2(address(token));
        token.mint(buyer, AMOUNT * 3);
        vm.prank(buyer);
        token.approve(address(escrow), type(uint256).max);
    }

    function _createEscrow() private {
        vm.prank(buyer);
        escrow.createEscrow(ESCROW_ID, seller, AMOUNT);
    }

    function _status() private view returns (ProofPayEscrowV2.Status status) {
        (, , , status) = escrow.getEscrow(ESCROW_ID);
    }

    // ---------------------------------------------------------------
    // Ported from v1 (behaviour that must not change)
    // ---------------------------------------------------------------

    function testCreateEscrowLocksFundsAndStoresParticipants() public {
        _createEscrow();

        (address storedBuyer, address storedSeller, uint256 amount, ProofPayEscrowV2.Status status) =
            escrow.getEscrow(ESCROW_ID);
        assertEq(storedBuyer, buyer);
        assertEq(storedSeller, seller);
        assertEq(amount, AMOUNT);
        assertEq(uint256(status), uint256(ProofPayEscrowV2.Status.Funded));
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testHappyPathReleasesFundsOnlyAfterSellerDelivery() public {
        _createEscrow();
        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.prank(buyer);
        escrow.releaseFunds(ESCROW_ID);

        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Released));
        assertEq(token.balanceOf(seller), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
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

    function testOwnerCanPauseAndUnpause() public {
        assertEq(escrow.paused(), false);
        escrow.pause();
        assertEq(escrow.paused(), true);
        escrow.unpause();
        assertEq(escrow.paused(), false);
    }

    function testNonOwnerCannotPause() public {
        vm.expectRevert("Only owner");
        vm.prank(outsider);
        escrow.pause();
    }

    function testCannotCreateEscrowWhilePaused() public {
        escrow.pause();
        vm.expectRevert("Contract is paused");
        vm.prank(buyer);
        escrow.createEscrow(ESCROW_ID, seller, AMOUNT);
    }

    function testPauseDoesNotBlockExistingEscrowLifecycle() public {
        _createEscrow();
        escrow.pause();

        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.prank(buyer);
        escrow.releaseFunds(ESCROW_ID);

        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Released));
        assertEq(token.balanceOf(seller), AMOUNT);
    }

    function testCannotDoublePause() public {
        escrow.pause();
        vm.expectRevert("Already paused");
        escrow.pause();
    }

    function testCannotUnpauseWhenNotPaused() public {
        vm.expectRevert("Not paused");
        escrow.unpause();
    }

    // ---------------------------------------------------------------
    // New: nobody can refund themselves once the buyer has deposited
    // ---------------------------------------------------------------

    function testRefundFunctionNoLongerExists() public {
        _createEscrow();
        vm.prank(buyer);
        (bool ok, ) = address(escrow).call(abi.encodeWithSignature("refund(string)", ESCROW_ID));
        assertFalse(ok, "refund(string) must not exist");
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Funded));
    }

    function testBuyerCannotTakeFundsBackWhileFunded() public {
        _createEscrow();
        uint256 buyerBefore = token.balanceOf(buyer);

        // Every function the buyer can reach leaves the money in the contract.
        vm.startPrank(buyer);
        vm.expectRevert("Delivery is not confirmed");
        escrow.releaseFunds(ESCROW_ID);
        vm.expectRevert("Only seller can confirm delivery");
        escrow.confirmDelivery(ESCROW_ID);
        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
        vm.stopPrank();

        assertEq(token.balanceOf(buyer), buyerBefore);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Funded));
    }

    function testSellerCannotTakeFundsWhileFundedOrDelivered() public {
        _createEscrow();
        vm.startPrank(seller);
        vm.expectRevert("Only buyer can release funds");
        escrow.releaseFunds(ESCROW_ID);
        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, 0);
        escrow.confirmDelivery(ESCROW_ID);
        vm.expectRevert("Only buyer can release funds");
        escrow.releaseFunds(ESCROW_ID);
        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, 0);
        vm.stopPrank();

        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testCannotResolveWithoutADispute() public {
        _createEscrow();
        vm.expectRevert("Escrow is not disputed");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);

        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.expectRevert("Escrow is not disputed");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
    }

    // ---------------------------------------------------------------
    // New: once a dispute is open, only the owner can move the money
    // ---------------------------------------------------------------

    function testOpenDisputeFreezesEveryBuyerAndSellerAction() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);
        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Disputed));

        vm.startPrank(buyer);
        vm.expectRevert("Delivery is not confirmed");
        escrow.releaseFunds(ESCROW_ID);
        vm.expectRevert("Escrow cannot be disputed");
        escrow.openDispute(ESCROW_ID);
        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
        vm.stopPrank();

        vm.startPrank(seller);
        vm.expectRevert("Escrow is not funded");
        escrow.confirmDelivery(ESCROW_ID);
        vm.expectRevert("Only buyer can release funds");
        escrow.releaseFunds(ESCROW_ID);
        vm.expectRevert("Escrow cannot be disputed");
        escrow.openDispute(ESCROW_ID);
        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, 0);
        vm.stopPrank();

        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testDisputeAfterDeliveryAlsoFreezesRelease() public {
        _createEscrow();
        vm.prank(seller);
        escrow.confirmDelivery(ESCROW_ID);
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);

        vm.expectRevert("Delivery is not confirmed");
        vm.prank(buyer);
        escrow.releaseFunds(ESCROW_ID);
        assertEq(token.balanceOf(address(escrow)), AMOUNT);
    }

    function testAdminCanRefundBuyerInFullAfterDispute() public {
        _createEscrow();
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.prank(seller);
        escrow.openDispute(ESCROW_ID);

        escrow.resolveDispute(ESCROW_ID, AMOUNT);

        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Refunded));
        assertEq(token.balanceOf(buyer), buyerBefore + AMOUNT);
        assertEq(token.balanceOf(seller), 0);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testAdminCanPaySellerInFullAfterDispute() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);

        escrow.resolveDispute(ESCROW_ID, 0);

        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Released));
        assertEq(token.balanceOf(seller), AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testAdminCanSplitAfterDispute() public {
        _createEscrow();
        vm.prank(seller);
        escrow.openDispute(ESCROW_ID);
        escrow.resolveDispute(ESCROW_ID, 40e6);

        assertEq(token.balanceOf(buyer), AMOUNT * 2 + 40e6);
        assertEq(token.balanceOf(seller), 60e6);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    function testResolvedDisputeCannotBeResolvedTwice() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);
        escrow.resolveDispute(ESCROW_ID, AMOUNT);

        vm.expectRevert("Escrow is not disputed");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
    }

    function testPauseDoesNotBlockDisputeResolution() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);
        escrow.pause();

        escrow.resolveDispute(ESCROW_ID, AMOUNT);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // The whole locked amount is always accounted for, whatever the admin picks.
    function testFuzzResolveDisputeConservesFunds(uint256 buyerAmount) public {
        buyerAmount = bound(buyerAmount, 0, AMOUNT);
        _createEscrow();
        uint256 buyerBefore = token.balanceOf(buyer);
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);

        escrow.resolveDispute(ESCROW_ID, buyerAmount);

        assertEq(token.balanceOf(buyer), buyerBefore + buyerAmount);
        assertEq(token.balanceOf(seller), AMOUNT - buyerAmount);
        assertEq(token.balanceOf(address(escrow)), 0);
    }

    // The backend and frontend hard-code these numbers.
    function testStatusNumbersMatchTheDeployedV1() public pure {
        assertEq(uint256(ProofPayEscrowV2.Status.None), 0);
        assertEq(uint256(ProofPayEscrowV2.Status.Funded), 1);
        assertEq(uint256(ProofPayEscrowV2.Status.Delivered), 2);
        assertEq(uint256(ProofPayEscrowV2.Status.Released), 3);
        assertEq(uint256(ProofPayEscrowV2.Status.Refunded), 4);
        assertEq(uint256(ProofPayEscrowV2.Status.Disputed), 5);
    }

    // ---------------------------------------------------------------
    // New: two-step ownership transfer
    // ---------------------------------------------------------------

    function testDeployerIsInitialOwner() public view {
        assertEq(escrow.owner(), address(this));
        assertEq(escrow.pendingOwner(), address(0));
    }

    function testOwnershipMovesOnlyAfterTheNewOwnerAccepts() public {
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), address(this), "owner must not change before accept");
        assertEq(escrow.pendingOwner(), newOwner);

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));
    }

    function testNewOwnerCanResolveAndOldOwnerCannot() public {
        _createEscrow();
        vm.prank(buyer);
        escrow.openDispute(ESCROW_ID);

        escrow.transferOwnership(newOwner);
        vm.prank(newOwner);
        escrow.acceptOwnership();

        vm.expectRevert("Only owner");
        escrow.resolveDispute(ESCROW_ID, AMOUNT);

        vm.prank(newOwner);
        escrow.resolveDispute(ESCROW_ID, AMOUNT);
        assertEq(uint256(_status()), uint256(ProofPayEscrowV2.Status.Refunded));
    }

    function testOldOwnerKeepsControlIfTheAddressIsWrongAndNeverAccepts() public {
        escrow.transferOwnership(outsider);
        // Nobody accepts. The admin role is still usable by the current owner.
        escrow.pause();
        assertEq(escrow.paused(), true);
    }

    function testOnlyOwnerCanStartATransfer() public {
        vm.expectRevert("Only owner");
        vm.prank(outsider);
        escrow.transferOwnership(outsider);
    }

    function testCannotTransferToTheZeroAddress() public {
        vm.expectRevert("New owner is zero address");
        escrow.transferOwnership(address(0));
    }

    function testOnlyThePendingOwnerCanAccept() public {
        escrow.transferOwnership(newOwner);
        vm.expectRevert("Only pending owner");
        vm.prank(outsider);
        escrow.acceptOwnership();
        vm.expectRevert("Only pending owner");
        vm.prank(buyer);
        escrow.acceptOwnership();
    }

    function testAcceptWithNothingPendingReverts() public {
        vm.expectRevert("Only pending owner");
        vm.prank(outsider);
        escrow.acceptOwnership();
    }

    function testOwnerCanReplaceAPendingTransfer() public {
        escrow.transferOwnership(outsider);
        escrow.transferOwnership(newOwner);

        vm.expectRevert("Only pending owner");
        vm.prank(outsider);
        escrow.acceptOwnership();

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
    }
}
