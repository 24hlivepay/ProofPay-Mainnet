// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ProofPayEscrowV2 — NOT YET DEPLOYED. ProofPayEscrow.sol is the deployed v1
// and must not be edited (it has to match what is verified on chain).
//
// What changed from v1, and nothing else:
//   1. refund() is removed (and the FundsRefunded event nothing emits any more).
//      In v1 the buyer could take the money back alone, at any time before the
//      seller confirmed delivery. That is not the intended design.
//   2. `owner` can be handed over with a two-step transfer (transferOwnership,
//      then acceptOwnership by the new owner). In v1 it was immutable, so the
//      dispute admin could never be moved to a multisig.
//
// The rule this contract enforces: once the buyer has deposited, neither the
// buyer nor the seller can take the money out on their own. It leaves only by:
//   - the buyer calling releaseFunds after the seller confirmed delivery, or
//   - the owner (admin) calling resolveDispute after either side opened a
//     dispute. The owner decides the split: full refund to the buyer, full
//     payment to the seller, or any amount in between.
//
// Status values keep the same numbers as v1 so the backend and frontend
// mappings do not change. `Refunded` is now only reachable through
// resolveDispute with the full amount going to the buyer.

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ProofPayEscrowV2 {
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
    address public owner;
    address public pendingOwner;
    uint256 private locked = 1;
    bool public paused;

    mapping(string => Escrow) public escrows;

    event EscrowCreated(string indexed escrowId, address indexed buyer, address indexed seller, uint256 amount);
    event DeliveryConfirmed(string indexed escrowId, address indexed seller);
    event FundsReleased(string indexed escrowId, address indexed seller, uint256 amount);
    event DisputeOpened(string indexed escrowId, address indexed openedBy);
    event DisputeResolved(string indexed escrowId, uint256 buyerAmount, uint256 sellerAmount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier nonReentrant() {
        require(locked == 1, "Reentrant call");
        locked = 2;
        _;
        locked = 1;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // Blocks new deposits only. Delivery confirmation, fund release, and
    // dispute resolution all keep working while paused, so a pause can never
    // trap funds that are already locked in an escrow.
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor(address usdcAddress) {
        require(usdcAddress != address(0), "USDC address is required");
        usdc = IERC20(usdcAddress);
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // Two-step handover: the current owner names a new owner, and nothing
    // changes until that address calls acceptOwnership. A typo in the address
    // therefore cannot lock the admin role away, because the old owner stays
    // in control until the new one accepts.
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "New owner is zero address");
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "Only pending owner");
        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    // Emergency stop for new escrow creation. Does not affect existing
    // escrows — buyers/sellers can still confirm delivery, release, or open
    // disputes, and the owner can still resolve disputes, on escrows created
    // before the pause.
    function pause() external onlyOwner {
        require(!paused, "Already paused");
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        require(paused, "Not paused");
        paused = false;
        emit Unpaused(msg.sender);
    }

    function createEscrow(string calldata escrowId, address seller, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        require(bytes(escrowId).length > 0, "Escrow ID is required");
        require(escrows[escrowId].buyer == address(0), "Escrow already exists");
        require(seller != address(0) && seller != msg.sender, "Invalid seller");
        require(amount > 0, "Amount must be greater than zero");

        escrows[escrowId] = Escrow(msg.sender, seller, amount, Status.Funded);
        _safeTransferFrom(msg.sender, address(this), amount);

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
        _safeTransfer(escrow.seller, escrow.amount);
        emit FundsReleased(escrowId, escrow.seller, escrow.amount);
    }

    function openDispute(string calldata escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.buyer == msg.sender || escrow.seller == msg.sender, "Only participants can dispute");
        require(escrow.status == Status.Funded || escrow.status == Status.Delivered, "Escrow cannot be disputed");

        escrow.status = Status.Disputed;
        emit DisputeOpened(escrowId, msg.sender);
    }

    function resolveDispute(string calldata escrowId, uint256 buyerAmount) external onlyOwner nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.status == Status.Disputed, "Escrow is not disputed");
        require(buyerAmount <= escrow.amount, "Invalid buyer amount");

        uint256 sellerAmount = escrow.amount - buyerAmount;
        escrow.status = buyerAmount == escrow.amount ? Status.Refunded : Status.Released;

        if (buyerAmount > 0) _safeTransfer(escrow.buyer, buyerAmount);
        if (sellerAmount > 0) _safeTransfer(escrow.seller, sellerAmount);

        emit DisputeResolved(escrowId, buyerAmount, sellerAmount);
    }

    function getEscrow(string calldata escrowId)
        external
        view
        returns (address buyer, address seller, uint256 amount, Status status)
    {
        Escrow memory escrow = escrows[escrowId];
        return (escrow.buyer, escrow.seller, escrow.amount, escrow.status);
    }

    function _safeTransfer(address to, uint256 amount) private {
        (bool success, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "USDC transfer failed");
    }

    function _safeTransferFrom(address from, address to, uint256 amount) private {
        (bool success, bytes memory data) = address(usdc).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount)
        );
        require(success && (data.length == 0 || abi.decode(data, (bool))), "USDC transferFrom failed");
    }
}
