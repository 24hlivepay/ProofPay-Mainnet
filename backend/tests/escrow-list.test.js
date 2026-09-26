import test from "node:test";
import assert from "node:assert/strict";
import { lastActivityAt, listEscrowsForCaller, pickNewEscrowFields } from "../lib/escrowList.js";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const ADMIN = "0x4444444444444444444444444444444444444444";

const CATEGORIES = { active: ["Funds Locked"], completed: ["Released"], pending: ["Waiting Seller"] };
const escrowNetwork = (escrow) => escrow.network || "testnet";

const deals = [
  { escrowId: "A", network: "mainnet", status: "Funds Locked", buyerWallet: BUYER, sellerWallet: SELLER, verificationCode: "123456", buyerEmail: "b@x.io", sellerEmail: "s@x.io", documents: [{ id: "d" }] },
  { escrowId: "B", network: "mainnet", status: "Funds Locked", buyerWallet: OTHER, sellerWallet: SELLER, verificationCode: "999999", buyerEmail: "o@x.io" },
  { escrowId: "C", network: "testnet", status: "Funds Locked", buyerWallet: BUYER, sellerWallet: SELLER },
  { escrowId: "D", network: "mainnet", status: "Released", buyerWallet: BUYER, sellerWallet: SELLER, dispute: { openedAt: 1 } },
];

const list = (extra) =>
  listEscrowsForCaller({
    allEscrows: deals,
    network: "mainnet",
    escrowNetwork,
    category: "active",
    statusCategories: CATEGORIES,
    role: "buyer",
    callerAddress: BUYER,
    adminAddress: ADMIN,
    ...extra,
  });

test("a caller only gets their own deals on the current network", () => {
  assert.deepEqual(list().map((e) => e.escrowId), ["A"]);
});

test("no signed-in wallet means an empty list, never everyone's deals", () => {
  assert.deepEqual(list({ callerAddress: "" }), []);
  assert.deepEqual(list({ callerAddress: undefined }), []);
});

test("the buyer never gets the verification code, the seller does", () => {
  assert.equal(list()[0].verificationCode, undefined);
  const asSeller = list({ role: "seller", callerAddress: SELLER });
  assert.deepEqual(asSeller.map((e) => e.escrowId), ["A", "B"]);
  assert.equal(asSeller[0].verificationCode, "123456");
});

test("a stranger gets nothing, even asking for the buyer or seller role", () => {
  assert.deepEqual(list({ callerAddress: "0x9999999999999999999999999999999999999999" }), []);
  assert.deepEqual(list({ role: "seller", callerAddress: "0x9999999999999999999999999999999999999999" }), []);
});

test("deal documents never appear in the list", () => {
  assert.equal("documents" in list()[0], false);
});

test("disputes category returns only deals with a dispute", () => {
  assert.deepEqual(list({ category: "disputes" }).map((e) => e.escrowId), ["D"]);
});

test("address comparison ignores case", () => {
  assert.deepEqual(list({ callerAddress: BUYER.toUpperCase().replace("0X", "0x") }).map((e) => e.escrowId), ["A"]);
});

test("a new deal takes only the allowed fields from the client", () => {
  const picked = pickNewEscrowFields({
    buyerName: " Ann ",
    buyerWallet: BUYER,
    buyerEmail: "a@x.io",
    productName: "Car",
    productId: "7",
    description: "desc",
    amount: "12.5",
    dispute: { resolution: { winner: "buyer" } },
    status: "Released",
    verificationCode: "000000",
    sellerWallet: OTHER,
    documents: [{ id: "x" }],
    isPermanent: true,
  });
  assert.equal(picked.buyerName, "Ann");
  assert.equal(picked.amount, "12.5");
  for (const key of ["dispute", "status", "verificationCode", "sellerWallet", "documents", "isPermanent"]) {
    assert.equal(key in picked, false, key);
  }
});

test("non-string fields are dropped, not stored as objects", () => {
  const picked = pickNewEscrowFields({ buyerName: { a: 1 }, description: ["x"], amount: 5 });
  assert.equal(picked.buyerName, "");
  assert.equal(picked.description, "");
  assert.equal(picked.amount, "5");
});

test("newest activity comes first, so a just-settled dispute tops the completed list", () => {
  const mk = (escrowId, extra) => ({ escrowId, network: "mainnet", status: "Released", buyerWallet: BUYER, sellerWallet: SELLER, createdAt: 100, ...extra });
  const all = [
    mk("old", { releasedAt: 1000 }),
    mk("mid", { releasedAt: 2000 }),
    mk("disputed", { createdAt: 50, dispute: { openedAt: 500, resolution: { resolvedAt: 9000 } } }),
  ];
  const out = listEscrowsForCaller({ allEscrows: all, network: "mainnet", escrowNetwork, category: "completed", statusCategories: CATEGORIES, role: "buyer", callerAddress: BUYER, adminAddress: ADMIN });
  assert.deepEqual(out.map((e) => e.escrowId), ["disputed", "mid", "old"]);
});

test("a deal with no timestamps sorts last instead of breaking the list", () => {
  assert.equal(lastActivityAt({}), 0);
  assert.equal(lastActivityAt({ createdAt: "x" }), 0);
});

// Guard against someone dropping the sign-in requirement again: these two routes
// used to be public.
import { readFileSync } from "node:fs";
const serverSource = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("creating a deal and listing deals both require a sign-in", () => {
  assert.match(serverSource, /app\.post\("\/api\/escrow", requireAuth\(\)/);
  assert.match(serverSource, /app\.get\("\/api\/escrows", requireAuth\(\)/);
});

test("the buyer of a new deal is taken from the sign-in, not the request body", () => {
  assert.match(serverSource, /buyerWallet: req\.auth\.address,/);
});
