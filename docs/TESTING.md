# ProofPay testing and judge walkthrough

## Automated validation

From the repository root:

```bash
npm install
npm --prefix frontend install
npm --prefix backend install
npm run validate
```

This command runs frontend lint, the production build, 12 escrow contract tests,
and backend syntax checks. Contract coverage includes creation and fund locking,
delivery and release, pre-delivery refund, dispute splitting, access controls,
invalid input rejection, and duplicate ID protection.

## Final public smoke test

Run these checks in a private/incognito browser with testnet-only funds:

1. Open `https://proofpay.online/api/health`; confirm the backend and database
   are healthy.
2. Sign in with a Circle email wallet and separately connect MetaMask or Rabby.
3. Buyer: create a USDC escrow and copy the seller link.
4. Seller: open the link, verify the details, and accept.
5. Buyer: deposit; confirm the lock transaction on Arcscan.
6. Seller: confirm delivery.
7. Buyer: release funds; confirm the release transaction and completed order.
8. Repeat one short flow with EURC or cirBTC.
9. Confirm pending, active, completed, and cancelled filters work for both roles.
10. Test mobile layout and a rejected/cancelled order.

Record the date, browser, wallet type, asset, escrow ID, and Arcscan transaction
links. Do not put wallet secrets, OTPs, API keys, or database credentials in the
recording or submission.

## Known scope

ProofPay is a public Arc Testnet MVP. Public testing and automated tests provide
confidence in the demonstrated flows, but they do not replace an independent
smart-contract audit. The application must not be represented as mainnet-ready
or suitable for real funds.
