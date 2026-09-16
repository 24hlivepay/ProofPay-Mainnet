// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// NOTE: This is the canonical, deployed ProofPay escrow contract.
// foundry/script/*.s.sol (used for the USDC/EURC/cirBTC deployments referenced
// in the README) import this file. contracts/ProofPayEscrow.sol is a second,
// OpenZeppelin-based implementation kept for the Hardhat toolchain
// (scripts/deploy.ts) — it is functionally mirrored to match this file, but
// if you only ever deploy through Foundry, this is the source of truth.
// Keep both in sync, or retire one path, before adding new features.

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract ProofPayEscrow {
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
    address public immutable owner;
    uint256 private locked = 1;
    bool public paused;

    mapping(string => Escrow) public escrows;

    event EscrowCreated(string indexed escrowId, address indexed buyer, address indexed seller, uint256 amount);
    event DeliveryConfirmed(string indexed escrowId, address indexed seller);
    event FundsReleased(string indexed escrowId, address indexed seller, uint256 amount);
    event FundsRefunded(string indexed escrowId, address indexed buyer, uint256 amount);
    event DisputeOpened(string indexed escrowId, address indexed openedBy);
    event DisputeResolved(string indexed escrowId, uint256 buyerAmount, uint256 sellerAmount);
    event Paused(address indexed account);
    event Unpaused(address indexed account);

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

    // Blocks new deposits only. Delivery confirmation, fund release, refunds,
    // and dispute resolution all keep working while paused, so a pause can
    // never trap funds that are already locked in an escrow.
    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    constructor(address usdcAddress) {
        require(usdcAddress != address(0), "USDC address is required");
        usdc = IERC20(usdcAddress);
        owner = msg.sender;
    }

    // Emergency stop for new escrow creation. Does not affect existing
    // escrows — buyers/sellers can still confirm delivery, release, refund,
    // or resolve disputes on escrows created before the pause.
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

    function refund(string calldata escrowId) external nonReentrant {
        Escrow storage escrow = escrows[escrowId];
        require(escrow.buyer == msg.sender, "Only buyer can request a refund");
        require(escrow.status == Status.Funded, "Refund is no longer available");

        escrow.status = Status.Refunded;
        _safeTransfer(escrow.buyer, escrow.amount);
        emit FundsRefunded(escrowId, escrow.buyer, escrow.amount);
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
