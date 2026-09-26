# ProofPayEscrowV2: audit package

Everything an independent auditor needs to start. One contract, 207 lines, no imports.

## 1. Scope

| | |
|---|---|
| In scope | `foundry/src/ProofPayEscrowV2.sol` (the only production contract) |
| Deploy script (review the checks) | `foundry/script/DeployV2Escrows.s.sol` |
| Out of scope | `ProofPayEscrow.sol` (v1, retired and paused on mainnet, holds no funds), backend, frontend |
| Source hash (sha256) | `4ba969563bdc21f413096238bbaa3298db1fd12a0a870df63d711de06ef37f32` |
| First commit | `f19ff70` (PR #20) |
| Compiler | solc 0.8.28 exactly, optimizer off, EVM version `prague` (Foundry defaults, see `foundry.toml`), metadata hash ipfs |

One contract is deployed per token. The constructor takes the token address (variable `usdc`); the same code is used for USDC and EURC.

## 2. Deployments

Chain: Arc by Circle. Mainnet chain id 5042 (`https://rpc.mainnet.arc.io`, explorer `explorer.arc.io`), testnet 5042002 (`https://rpc.testnet.arc.network`, explorer `testnet.arcscan.app`). The chain's gas token is USDC. The ERC-20 interface of USDC lives at `0x3600000000000000000000000000000000000000` (6 decimals) while native balances use 18 decimals.

| Network | Token | Escrow contract | Deploy tx |
|---|---|---|---|
| Mainnet | USDC | `0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B` | `0x145e96c4ba7857404a56a57d7a3a1c31ede58101055224d97598d8c8b3f994e4` |
| Mainnet | EURC | `0x7894E539a16b0D1aE272BE4ebF998353C6E15C86` | `0x5e7ff5b11194d10616e9a4da869197ddea39c38393b76c9b28295c7545daef2a` |
| Testnet | USDC | `0xbf28D1d4cb480DDAc52c23670aFECA94D4d719a1` | `0xe89ec93681f74ed0e0ffb7fe6368981c106251c7fa0110aa289420f9d299e7e5` |
| Testnet | EURC | `0x7117B300A01C969082DE898F1B1f699F6e8188B3` | `0x5d6aec739ba0f8e0d3fcae397eed1ed71737a4b64e452ec3dd68c9fbaedb83fb` |

Owner (dispute admin) today: EOA `0xD979e5D9EEB1126C75a7B215Ee0f79895Fe091AC`, no pending owner, not paused. Explorer source verification: not done yet.

## 3. What the contract must guarantee

1. After a buyer deposits (`createEscrow`), neither buyer nor seller can take the money out alone. It leaves only by
   - the buyer calling `releaseFunds` after the seller called `confirmDelivery`, or
   - the owner calling `resolveDispute` after a participant called `openDispute`.
2. Funds are conserved: every escrow pays out exactly `amount`, once. `buyerAmount + sellerAmount == amount`, and a settled escrow can never be settled again.
3. There is no way to send tokens to a party from any other path (no rescue or sweep function, no upgrade proxy, no self-destruct, no delegatecall).
4. Pausing blocks only new deposits. It must never trap funds already locked.
5. Ownership moves only through the two-step handover; a wrong address cannot lock the role.
6. `Status` numbers (None 0, Funded 1, Delivered 2, Released 3, Refunded 4, Disputed 5) match the deployed v1, because the backend reads them.

Difference from v1: `refund()` (buyer could self-refund before delivery) and the `FundsRefunded` event were removed, and the owner became transferable.

## 4. Trust model (by design, please still judge it)

- The owner has full discretion over a disputed escrow: any split from 0 to `amount`. There is no timelock, appeal, or cap. This is the product's dispute model, and the owner key is therefore the main risk.
- The owner is one EOA today. The backend requires the resolve transaction's `from` to equal `DISPUTE_ADMIN_WALLET`, so a multisig needs a backend change first.
- Either party can open a dispute at any time while Funded or Delivered, which freezes the escrow until the owner decides.
- If the owner key is lost, disputed escrows stay frozen for good. Escrows that were never disputed still finish normally.

## 5. Self-review notes (please confirm or overrule)

| # | Severity (my view) | Note |
|---|---|---|
| 1 | Medium (operational) | Token blacklist: `resolveDispute` transfers to buyer and seller. If a recipient is blacklisted by the token issuer, the call reverts. The owner can dodge it by giving 100% to the non-blacklisted side, but cannot pay a split. `releaseFunds` to a blacklisted seller also reverts (the buyer can then open a dispute). Kept deliberately, documented. |
| 2 | Low | The constructor does not check that `usdcAddress` has code. `_safeTransferFrom` treats a call to an address with no code as success (empty return data), so an escrow on such a token would record a deposit that never happened. Mitigated off-chain: the deploy script requires code, decimals 6, and a symbol. All four deployments were checked on chain. |
| 3 | Low | The escrow id is a caller-chosen string, first come first served. Someone who knows an id before the buyer deposits can create it first with their own funds, so the buyer's `createEscrow` reverts ("Escrow already exists"). No funds of the buyer are at risk; the backend cross-checks buyer, seller, and amount against the chain before trusting a deposit. Ids are random (40 bits) and are not published before the deposit. |
| 4 | Info | Fee-on-transfer or rebasing tokens are not supported (the stored amount is the requested amount, not the amount received). Fine for USDC and EURC; the constructor accepts any address. |
| 5 | Info | `escrowId` is an indexed `string` in events, so logs carry only its hash. Off-chain code matches ids through the hash or through `getEscrow`. |
| 6 | Info | `transferOwnership` can be called again to replace a pending owner, but not to clear it (zero address is rejected). Overwriting with the current owner's own address is the way to cancel. |
| 7 | Info | `confirmDelivery` and `openDispute` have no `nonReentrant`; they make no external calls. `createEscrow` writes state before the external `transferFrom`, and all payout paths set the final status before transferring. |
| 8 | Info | The source header comment still says "NOT YET DEPLOYED". Left untouched on purpose: changing the file changes the metadata hash and would break exact-match explorer verification of the deployed bytecode. |

## 6. Tests

`cd foundry && forge test` gives 59 passing tests in total (37 for V2 in `test/ProofPayEscrowV2.t.sol`, 2 for the deploy script in `test/DeployV2Escrows.t.sol`, 20 for v1 kept for comparison).

Coverage of `ProofPayEscrowV2.sol` (`forge coverage --report summary`): lines 100% (76/76), statements 100% (65/65), branches 91.3% (42/46), functions 100% (16/16). The 4 uncovered branches are the reentrancy revert in `nonReentrant` (line 67), the zero-token-address revert in the constructor (line 87), and the failure paths of the two internal transfer helpers (lines 198 and 205).

Test groups: happy path and role checks, invalid inputs and duplicate ids, pause and unpause (including that pause never blocks delivery, release, dispute, or resolution), refund function does not exist, buyer and seller cannot move funds while Funded, Delivered, or Disputed, admin full refund / full payment / split, no double resolution, a fuzz test that resolution conserves funds, status numbers equal v1, and the ownership handover (accept, wrong address, replace pending, zero address).

A control run showed the same buyer refund call succeeds on v1, so the test proves the fix.

## 7. Suggestions for the auditor to look at

- Reentrancy through a malicious token (the constructor accepts any token).
- Anything that lets a settled escrow be paid a second time.
- Interaction of pause with every state.
- Behavior of the real Arc USDC ERC-20 interface (native-backed, blacklist) versus the mock used in tests.
- The owner-handover state machine.
- Whether the trust model in section 4 is acceptable, and whether a dispute timeout or a multisig owner should be required before more value is held.

## 8. How to reproduce

```bash
git clone https://github.com/24hlivepay/ProofPay-Mainnet
cd ProofPay-Mainnet/foundry
forge build
forge test
forge coverage --report summary
```

Read-only on-chain checks (no key needed):

```bash
cast call 0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B "owner()(address)" --rpc-url https://rpc.mainnet.arc.io
cast call 0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B "usdc()(address)" --rpc-url https://rpc.mainnet.arc.io
cast call 0xbA8cf9bE18DE912dC98a6422906b1D8F0e56F76B "paused()(bool)" --rpc-url https://rpc.mainnet.arc.io
```

Contact for the audit: the project owner (24hlive.eth).
