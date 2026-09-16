# ProofPay configuration

This guide maps every required environment value to the service where it must
be configured. Never commit real keys or database credentials.

## Production deployment (Vercel Services)

Import the repository using the root `vercel.json`. Configure the variables in
the Vercel project settings before redeploying.

### Backend service

| Variable | Required | Value / source |
| --- | --- | --- |
| `CIRCLE_API_KEY` | Yes | Circle Developer Console standard API key |
| `DATABASE_URL` | Yes for production | Neon pooled Postgres connection string |
| `FRONTEND_URL` | Yes | `https://proofpay.online` |
| `NODE_ENV` | Recommended | `production` |

`PORT` is assigned by the platform. Do not set `DATA_DIR` on Vercel; without
`DATABASE_URL`, the fallback filesystem is temporary and must not be treated as
persistent storage.

### Frontend service

| Variable | Required | Value |
| --- | --- | --- |
| `VITE_API_URL` | Yes | `/api` |
| `VITE_CIRCLE_APP_ID` | Yes | Circle User-Controlled Wallet application ID |
| `VITE_EURC_ESCROW_ADDRESS` | Yes | `0xa4322D8ba3E040A3028FD6ABaC3c6a5625ed4ca7` |
| `VITE_CIRBTC_ESCROW_ADDRESS` | Yes | `0x8bfeD6F70Eb595946543b192b6E63d75A0bBEf4B` |

After changing any `VITE_` variable, rebuild/redeploy the frontend because Vite
embeds these values at build time.

## Circle Console

In **Wallets → User Controlled → Configurator → Email**:

1. Enable email authentication.
2. Add `https://proofpay.online` as an allowed origin/domain.
3. Confirm the frontend app ID and backend API key belong to the same Circle
   environment.
4. Use testnet wallets and Arc Testnet during judging.

## Neon

Use a pooled connection string with SSL. The backend creates the
`proofpay_records` table automatically. Verify persistence by creating an
escrow, redeploying the backend, and confirming the order still appears.

## Domain and routing

Point both apex and `www` domains to the Vercel project. The root configuration
routes `/api/*` to the backend and all other application routes to the Vite
frontend. Verify:

```text
https://proofpay.online/
https://proofpay.online/api/health
```

The health endpoint should return `status: "ok"` and `database: "connected"`.

## Contract deployment only

Copy the root `.env.example` to `.env`, set `RPC_URL` and `PRIVATE_KEY`, and run
deployment scripts only from a secured local machine. Prefer the encrypted
Foundry keystore workflow documented in the main README. Never place a private
key in Vercel or the frontend.
