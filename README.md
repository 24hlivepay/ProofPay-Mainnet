# ProofPay

Secure peer-to-peer USDC escrow on Arc Testnet.

[Live app](https://proofpay.online) · [Demo video](https://youtu.be/O791txQRc5E) · [Smart contract](https://testnet.arcscan.app/address/0xCd0f43E573899809ff96C560439570A760698C9a) · [Deployment transaction](https://testnet.arcscan.app/tx/0x79e8933c8df6707c0f5a91fc3f0e162f270100eb4514994d6d8536901dfe3f73)

> ProofPay is currently a public testnet MVP. It does not handle real funds and has not been audited.

## Why ProofPay

Peer-to-peer online deals often force one side to take the risk first: the buyer pays before delivery, or the seller delivers before payment. ProofPay replaces that trust gap with a transparent escrow flow where test USDC is held by a smart contract and released only after the seller confirms delivery and the buyer approves payment.

## Final-submission status

The public Arc Testnet MVP supports the complete escrow lifecycle:

1. A buyer creates an escrow request and shares a private review link.
2. The seller connects a wallet, verifies the deal, and accepts or rejects it.
3. After acceptance, the buyer deposits Arc Testnet USDC, EURC, or cirBTC into the matching escrow contract.
4. The seller confirms delivery.
5. The buyer releases the locked funds to the seller.

The web app also includes pending, active, completed, cancelled, and rejected
order states; persistent off-chain order metadata; transaction links to Arcscan;
Circle email wallets; and MetaMask and Rabby support. Developer-led testing is
complete and public testnet testing is ongoing.

## Live evidence

- Public application deployed at [proofpay.online](https://proofpay.online)
- Escrow contract deployed on Arc Testnet
- Circle email wallet, MetaMask, and Rabby flows implemented and tested
- Three completed end-to-end escrow tests across three wallets
- Persistent order records stored in Neon Postgres
- Frontend and backend deployed together through Vercel Services
- Automated escrow lifecycle and authorization tests

## Architecture

```text
Buyer / Seller
      │
      ▼
React + Vite frontend
      │
      ├──────── ethers.js ────────► ProofPayEscrow.sol
      │                              │
      │                              └── Arc Testnet USDC
      │
      └──────── REST API ─────────► Express backend
                                     │
                                     └── Neon Postgres
```

### Stack

- **Frontend:** React 19, Vite, Tailwind CSS, ethers.js
- **Wallets:** MetaMask and Rabby
- **Backend:** Express.js
- **Database:** Neon serverless Postgres
- **Contracts:** Solidity, OpenZeppelin, Hardhat and Foundry
- **Network:** Arc Testnet
- **Hosting:** Vercel Services

## Contract details

| Item | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| ProofPay escrow | `0xCd0f43E573899809ff96C560439570A760698C9a` |
| Test USDC | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| cirBTC | `0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF` |
| ProofPay USDC Escrow | `0xCd0f43E573899809ff96C560439570A760698C9a` |
| ProofPay EURC Escrow | `0xa4322D8ba3E040A3028FD6ABaC3c6a5625ed4ca7` |
| ProofPay cirBTC Escrow | `0x8bfeD6F70Eb595946543b192b6E63d75A0bBEf4B` |

The contract uses `SafeERC20`, `ReentrancyGuard`, participant-only state transitions, and an owner-controlled dispute resolution path.

## Repository structure

```text
contracts/   Solidity escrow contract
scripts/     Hardhat deployment script
foundry/     Foundry deployment and test workspace
frontend/    React/Vite web application
backend/     Express API and database integration
vercel.json  Multi-service production configuration
docs/        Configuration and judge-testing guides
submission/  Final form copy and presentation artifacts
```

### Deploy EURC and cirBTC escrow contracts

Use the same deployer account that owns the existing USDC escrow. Keep the
private key in an encrypted Foundry keystore; do not commit it to the project.

```bash
cast wallet import proofpay-deployer --interactive
forge script script/DeployAssetEscrows.s.sol:DeployAssetEscrows \
  --root foundry \
  --rpc-url arc \
  --account proofpay-deployer \
  --broadcast
```

Copy the two resulting addresses into `frontend/.env` as
`VITE_EURC_ESCROW_ADDRESS` and `VITE_CIRBTC_ESCROW_ADDRESS`.

## Local setup

### 1. Install dependencies

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
```

### 2. Configure the backend

```bash
cp backend/.env.example backend/.env
```

Set at minimum:

```env
PORT=5001
FRONTEND_URL=http://localhost:5173
DATABASE_URL=your_neon_postgres_connection_string
CIRCLE_API_KEY=your_circle_standard_api_key
```

The Circle API key stays on the backend and is required for email OTP and
user-controlled wallet creation.

### 3. Configure the frontend

```bash
cp frontend/.env.example frontend/.env
```

For local development:

```env
VITE_API_URL=http://localhost:5001/api
VITE_CIRCLE_APP_ID=your_circle_user_controlled_wallet_app_id
```

Email authentication must also be enabled and configured under
**Wallets → User Controlled → Configurator → Email** in the Circle Developer
Console.

### 4. Run both services

```bash
npm --prefix backend run dev
npm --prefix frontend run dev
```

## Validation

Run the complete local readiness check from the repository root:

```bash
npm run validate
```

This runs frontend lint, a production build, 12 ProofPay escrow contract tests,
and backend syntax checks. See [Testing and judge walkthrough](docs/TESTING.md)
for the public smoke-test flow.

## Production configuration

Use [Configuration](docs/CONFIGURATION.md) to set Vercel, Circle, Neon, domain,
and contract-deployment values in the correct service. Do not expose Circle API
keys, database credentials, or deployer private keys in frontend variables.

## Post-submission roadmap

- Expand public wallet and device testing
- Expand automated browser-level end-to-end coverage
- Complete an independent smart-contract security audit
- Add multi-signature or decentralized dispute administration
- Improve mobile onboarding and transaction guidance
- Complete security and operational reviews before any mainnet deployment

## License

This repository is provided for hackathon evaluation and testnet experimentation.
