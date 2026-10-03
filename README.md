# ProofPay

Secure peer-to-peer escrow for USDC and EURC on Arc, with a wallet, swap, bridge and onramp around it.

[Live app](https://proofpay.online) · [Docs](https://proofpay.online/#/docs) · [Demo video](https://youtu.be/O791txQRc5E) · [USDC escrow on Arc Mainnet](https://explorer.arc.io/address/0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B) · [EURC escrow on Arc Mainnet](https://explorer.arc.io/address/0x7894E539a16b0D1aE272BE4ebF998353C6E15C86)

> ProofPay is live on Arc Mainnet and Arc Testnet. The contracts are verified on the Arc explorer but have not had an independent audit yet. Use small amounts on mainnet.

## Why ProofPay

Peer-to-peer online deals often force one side to take the risk first: the buyer pays before delivery, or the seller delivers before payment. ProofPay removes that gap. The buyer locks USDC or EURC in a smart contract, the seller delivers, and the buyer releases the payment. If they cannot agree, either side opens a dispute and the ProofPay admin settles it on chain.

## What it does

- **Escrow.** A buyer creates a deal locked to the seller's wallet and shares a link. The seller accepts, the buyer deposits, the seller confirms delivery, the buyer releases. After the deposit neither side can take the money out alone.
- **Deal documents.** Buyer and seller can attach private files (PDF, JPG, PNG, WEBP, up to 10 MB) to a deal. Only the two of them can open the files. The admin cannot.
- **Disputes.** Either side can open a dispute with a written statement and evidence. The admin can refund the buyer, pay the seller, or split, with one transaction on the escrow contract. Every admin action is written to an audit log.
- **Wallet.** Balances of every token the address holds on Arc, receive, and send.
- **Swap.** USDC, EURC and cirBTC on Arc, for browser wallets and for email wallets.
- **Bridge.** USDC and EURC between Arc and Ethereum, Base, Arbitrum, Optimism, Polygon and Avalanche (EURC: Ethereum and Base), with Circle's forwarder so no gas is needed on the destination chain.
- **Onramp.** Buy USDC or EURC with a card or bank transfer, delivered to the user's wallet on Arc.
- **Two ways to sign in.** Email (a Circle user-controlled wallet, no extension needed) or any browser wallet such as MetaMask or Rabby.
- **Docs.** Every feature explained in plain words at [proofpay.online/#/docs](https://proofpay.online/#/docs).

## What ProofPay uses Arc for

| Arc / Circle building block | Used for |
| --- | --- |
| Arc Mainnet and Testnet | The escrow contracts and every deal transaction. Gas is paid in USDC. |
| USDC and EURC on Arc | The assets held in escrow. |
| Circle user-controlled wallets | Email sign-in, so a user needs no wallet extension. |
| App Kit swap | Swapping USDC, EURC and cirBTC on Arc. |
| App Kit bridge (CCTP, CCTPx, Forwarding Service) | Moving USDC and EURC between Arc and other chains. |
| App Kit onramp | Buying USDC and EURC with fiat. |

## Architecture

```text
Buyer / Seller
      │
      ▼
React + Vite frontend ──── Circle App Kit ───► swap · bridge (CCTP) · onramp
      │
      ├──────── ethers.js ────────► ProofPayEscrowV2 (one per asset)
      │                              │
      │                              └── USDC / EURC on Arc
      │
      └──────── REST API ─────────► Express backend
                                     │
                                     ├── Neon Postgres (deal records, history, profiles)
                                     ├── Private file storage (deal documents, evidence)
                                     └── Circle Wallets API (email wallets)
```

### Stack

- **Frontend:** React 19, Vite, Tailwind CSS, ethers.js, Circle App Kit
- **Wallets:** Circle user-controlled wallets (email), and any EIP-6963 browser wallet
- **Backend:** Express.js, wallet-signature sessions, admin sign-in with password and email code
- **Database:** Neon serverless Postgres
- **Contracts:** Solidity 0.8.28, Foundry and Hardhat
- **Networks:** Arc Mainnet (chain ID 5042) and Arc Testnet (chain ID 5042002)
- **Hosting:** Vercel

## Contract details

| Network | USDC escrow (V2) | EURC escrow (V2) |
| --- | --- | --- |
| Arc Mainnet | `0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B` | `0x7894E539a16b0D1aE272BE4ebF998353C6E15C86` |
| Arc Testnet | `0xbf28D1d4cb480DDAc52c23670aFECA94D4d719a1` | `0x7117B300A01C969082DE898F1B1f699F6e8188B3` |

The source is `foundry/src/ProofPayEscrowV2.sol`. It has participant-only state
transitions, a reentrancy guard, an owner-only dispute resolution that can pay
only the buyer and the seller of that deal, a pause that blocks new deposits but
never traps existing funds, and a two-step ownership handover. See
`foundry/AUDIT_PACKAGE.md` for the deployment transactions.

### Design rule: nobody refunds themselves

Once the buyer has deposited, neither the buyer nor the seller can take the
money out alone. It leaves the contract in only two ways:

1. The seller confirms delivery and the buyer releases the funds to the seller.
2. Either side opens a dispute. The funds freeze, buyer and seller can do
   nothing more, and only the admin (owner) decides: full refund to the buyer,
   full payment to the seller, or a split.

There must be no buyer-side `refund()` or any other way to pull funds back
without a dispute. The original v1 contracts contained a buyer-only `refund()`
from the prototype; they cannot be changed, so they are retired. `foundry/src/ProofPayEscrowV2.sol`
is the replacement without it, deployed on both networks (2026-09-26):

| Network | USDC escrow (V2) | EURC escrow (V2) |
| --- | --- | --- |
| Arc Testnet | `0xbf28D1d4cb480DDAc52c23670aFECA94D4d719a1` | `0x7117B300A01C969082DE898F1B1f699F6e8188B3` |
| Arc Mainnet | `0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B` | `0x7894E539a16b0D1aE272BE4ebF998353C6E15C86` |

The tests in `foundry/test/ProofPayEscrowV2.t.sol` enforce this rule and must keep passing.

## Repository structure

```text
contracts/   Solidity escrow contract (Hardhat copy)
scripts/     Hardhat deployment scripts
foundry/     Foundry sources, deployment scripts and contract tests
frontend/    React/Vite web application
backend/     Express API, tests and database integration
vercel.json  Production configuration
docs/        Configuration and testing guides
submission/  Earlier hackathon submission material
```

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

This runs frontend lint, a production build, the escrow contract tests,
and backend checks. See [Testing and judge walkthrough](docs/TESTING.md)
for the public smoke-test flow.

## Production configuration

Use [Configuration](docs/CONFIGURATION.md) to set Vercel, Circle, Neon, domain,
and contract-deployment values in the correct service. Do not expose Circle API
keys, database credentials, or deployer private keys in frontend variables.

## Roadmap

- Independent smart-contract security audit
- Move the dispute admin role from a single wallet to a multisig
- Bridge for email wallets
- Server-side confirmation of onramp purchases
- More automated browser-level end-to-end tests

## License

This repository is public so the code can be reviewed. An open-source license has not been chosen yet.
