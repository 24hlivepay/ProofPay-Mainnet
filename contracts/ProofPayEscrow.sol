// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// NOTE: This is the Hardhat-toolchain copy of the escrow contract
// (compiled/deployed via scripts/deploy.ts). foundry/src/ProofPayEscrow.sol
// is the copy the Foundry scripts (foundry/script/*.s.sol) deploy from —
// the two are kept functionally in sync by hand. Before adding a feature,
// decide which toolchain is canonical for mainnet and update both, or
// retire one deployment path so they cannot drift apart silently.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract ProofPayEscrow is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Delivered,
        Released,
        Refunded,
        Disputed
    }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount;
        Status status;
    }

    IERC20 public immutable usdc;
    mapping(string => Escrow) public escrows;

    event EscrowCreated(
        string indexed escrowId,
        address indexed buyer,
        address indexed seller,
        uint256 amount
    );
    event DeliveryConfirmed(string indexed escrowId, address indexed seller);
    event FundsReleased(string indexed escrowId, address indexed seller, uint256 amount);
    event FundsRefunded(string indexed escrowId, address indexed buyer, uint256 amount);
    event DisputeOpened(string indexed escrowId, address indexed openedBy);
    event DisputeResolved(
        string indexed escrowId,
        uint256 buyerAmount,
        uint256 sellerAmount
    );

    constructor(address usdcAddress) Ownable(msg.sender) {
        require(usdcAddress != address(0), "USDC address is required");
        usdc = IERC20(usdcAddress);
    }

    // Emergency stop for new escrow creation. Existing escrows can still be
    // delivered, released, refunded, or dispute-resolved while paused, so
    // funds already locked in the contract can never get stuck.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function createEscrow(
        string calldata escrowId,
        address seller,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(bytes(escrowId).length > 0, "Escrow ID is required");
        require(escrows[escrowId].buyer == address(0), "Escrow already exists");
        require(seller != address(0), "Seller address is required");
        require(seller != msg.sender, "Buyer and seller must differ");
        require(amount > 0, "Amount must be greater than zero");

        escrows[escrowId] = Escrow({
            buyer: msg.sender,
            seller: seller,
            amount: amount,
            status: Status.Funded
        });

        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit EscrowCreated(escrowId, msg.sender, seller, amount);
    }

    function confirmDelivery(string calldata escrowId) external {
        Escrow storage escrow = escrows[escrowId];

        require(escrow.seller == msg.sender, "Only seller can confirm delivery");
        require(escrow.status == Status.Funded, "Escrow is not funded");

        escrow.status = Status.Delivered;
        emit DeliveryConfirmed(escrowId, msg.sender);
    }

    function releaseFunds(string calldata escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];

        require(escrow.buyer == msg.sender, "Only buyer can release funds");
        require(escrow.status == Status.Delivered, "Delivery is not confirmed");

        escrow.status = Status.Released;
        usdc.safeTransfer(escrow.seller, escrow.amount);

        emit FundsReleased(escrowId, escrow.seller, escrow.amount);
    }

    function refund(string calldata escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];

        require(escrow.buyer == msg.sender, "Only buyer can request a refund");
        require(escrow.status == Status.Funded, "Refund is no longer available");

        escrow.status = Status.Refunded;
        usdc.safeTransfer(escrow.buyer, escrow.amount);

        emit FundsRefunded(escrowId, escrow.buyer, escrow.amount);
    }

    function openDispute(string calldata escrowId) external {
        Escrow storage escrow = escrows[escrowId];

        require(
            escrow.buyer == msg.sender || escrow.seller == msg.sender,
            "Only escrow participants can open a dispute"
        );
        require(
            escrow.status == Status.Funded || escrow.status == Status.Delivered,
            "Escrow cannot be disputed"
        );

        escrow.status = Status.Disputed;
        emit DisputeOpened(escrowId, msg.sender);
    }

    function resolveDispute(
        string calldata escrowId,
        uint256 buyerAmount
    ) external onlyOwner nonReentrant {
        Escrow storage escrow = escrows[escrowId];

        require(escrow.status == Status.Disputed, "Escrow is not disputed");
        require(buyerAmount <= escrow.amount, "Invalid buyer amount");

        uint256 sellerAmount = escrow.amount - buyerAmount;
        escrow.status = buyerAmount == escrow.amount
            ? Status.Refunded
            : Status.Released;

        if (buyerAmount > 0) {
            usdc.safeTransfer(escrow.buyer, buyerAmount);
        }
        if (sellerAmount > 0) {
            usdc.safeTransfer(escrow.seller, sellerAmount);
        }

        emit DisputeResolved(escrowId, buyerAmount, sellerAmount);
    }

    function getEscrow(
        string calldata escrowId
    ) external view returns (address buyer, address seller, uint256 amount, Status status) {
        Escrow memory escrow = escrows[escrowId];
        return (escrow.buyer, escrow.seller, escrow.amount, escrow.status);
    }
}
