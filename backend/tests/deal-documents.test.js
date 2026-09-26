import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DOCUMENT_UPLOAD_STATUSES,
  MAX_DEAL_DOCUMENTS_PER_SIDE,
  canRemoveDocument,
  canUploadDocuments,
  canViewDocuments,
  dealPartySide,
  documentSlotsLeft,
  isRemoved,
  publicDocuments,
  removedDocument,
} from "../lib/documents.js";
import { sanitizeEscrow } from "../lib/auth.js";

const BUYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SELLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ADMIN = "0xcccccccccccccccccccccccccccccccccccccccc";
const OUTSIDER = "0xdddddddddddddddddddddddddddddddddddddddd";

const STORED = (over = {}) => ({
  id: "doc-1",
  side: "buyer",
  name: "agreement.pdf",
  type: "application/pdf",
  size: 1234,
  uploadedAt: 1700000000000,
  path: "doc-1.pdf",
  blobUrl: "https://blob.example/private/deals/PP-1/buyer/doc-1.pdf",
  hash: "abc123",
  ...over,
});

const ESCROW = (over = {}) => ({
  escrowId: "PP-TEST01",
  buyerWallet: BUYER,
  sellerWallet: "",
  expectedSeller: SELLER,
  status: "Waiting Seller",
  documents: [STORED()],
  ...over,
});

describe("dealPartySide", () => {
  it("recognises the buyer, case-insensitively", () => {
    assert.equal(dealPartySide(ESCROW(), BUYER), "buyer");
    assert.equal(dealPartySide(ESCROW(), BUYER.toUpperCase().replace("0X", "0x")), "buyer");
  });

  it("treats the seller the buyer pinned as the seller before they accept", () => {
    assert.equal(dealPartySide(ESCROW(), SELLER), "seller");
  });

  it("recognises the accepted seller", () => {
    assert.equal(dealPartySide(ESCROW({ sellerWallet: SELLER }), SELLER), "seller");
  });

  it("does not let a pinned wallet count once a different seller has been recorded", () => {
    assert.equal(dealPartySide(ESCROW({ sellerWallet: OUTSIDER }), SELLER), null);
  });

  it("rejects the admin, an outsider, and missing input", () => {
    assert.equal(dealPartySide(ESCROW(), ADMIN), null);
    assert.equal(dealPartySide(ESCROW(), OUTSIDER), null);
    assert.equal(dealPartySide(ESCROW(), ""), null);
    assert.equal(dealPartySide(ESCROW(), null), null);
    assert.equal(dealPartySide(null, BUYER), null);
  });

  it("does not match an empty pinned seller against an empty wallet", () => {
    assert.equal(dealPartySide(ESCROW({ expectedSeller: "" }), ""), null);
  });
});

describe("canViewDocuments: buyer and seller only, never the admin", () => {
  it("allows the buyer and the seller", () => {
    assert.equal(canViewDocuments(ESCROW(), BUYER), true);
    assert.equal(canViewDocuments(ESCROW(), SELLER), true);
  });

  it("refuses the admin, even after a dispute has been opened", () => {
    assert.equal(canViewDocuments(ESCROW(), ADMIN), false);
    assert.equal(canViewDocuments(ESCROW({ status: "Disputed", dispute: { statement: "x" } }), ADMIN), false);
  });

  it("refuses outsiders", () => {
    assert.equal(canViewDocuments(ESCROW(), OUTSIDER), false);
  });
});

describe("canUploadDocuments", () => {
  it("allows uploads while the deal is open", () => {
    for (const status of ["Waiting Seller", "Seller Accepted", "Funds Locked", "Delivered"]) {
      assert.equal(canUploadDocuments({ status }), true, status);
    }
  });

  it("blocks uploads once the deal is disputed or finished", () => {
    for (const status of ["Disputed", "Released", "Refunded", "Cancelled", "Rejected", "Under review", "", undefined]) {
      assert.equal(canUploadDocuments({ status }), false, String(status));
    }
    assert.equal(canUploadDocuments(null), false);
    assert.equal(DOCUMENT_UPLOAD_STATUSES.has("Disputed"), false);
  });
});

describe("documentSlotsLeft", () => {
  it("counts each side separately", () => {
    const escrow = ESCROW({
      documents: [STORED({ id: "a" }), STORED({ id: "b" }), STORED({ id: "c", side: "seller" })],
    });
    assert.equal(documentSlotsLeft(escrow, "buyer"), MAX_DEAL_DOCUMENTS_PER_SIDE - 2);
    assert.equal(documentSlotsLeft(escrow, "seller"), MAX_DEAL_DOCUMENTS_PER_SIDE - 1);
  });

  it("never goes below zero and copes with no documents", () => {
    const full = ESCROW({ documents: Array.from({ length: 7 }, (_, i) => STORED({ id: `d${i}` })) });
    assert.equal(documentSlotsLeft(full, "buyer"), 0);
    assert.equal(documentSlotsLeft(ESCROW({ documents: undefined }), "buyer"), MAX_DEAL_DOCUMENTS_PER_SIDE);
    assert.equal(documentSlotsLeft(ESCROW({ documents: "nope" }), "buyer"), MAX_DEAL_DOCUMENTS_PER_SIDE);
  });
});

describe("publicDocuments", () => {
  it("keeps only the public fields", () => {
    const [doc] = publicDocuments(ESCROW());
    assert.deepEqual(Object.keys(doc).sort(), ["id", "name", "side", "size", "type", "uploadedAt"]);
    assert.equal(doc.name, "agreement.pdf");
  });

  it("returns an empty list when there are none", () => {
    assert.deepEqual(publicDocuments(ESCROW({ documents: undefined })), []);
  });
});

describe("sanitizeEscrow and documents", () => {
  it("shows the buyer and the seller the public fields only", () => {
    for (const wallet of [BUYER, SELLER]) {
      const out = sanitizeEscrow(ESCROW(), wallet, ADMIN);
      assert.equal(out.documents.length, 1);
      assert.equal("path" in out.documents[0], false);
      assert.equal("blobUrl" in out.documents[0], false);
      assert.equal("hash" in out.documents[0], false);
    }
  });

  it("gives the buyer an empty list when there are no documents yet", () => {
    assert.deepEqual(sanitizeEscrow(ESCROW({ documents: undefined }), BUYER, ADMIN).documents, []);
  });

  it("gives the admin NO documents, not even in a dispute", () => {
    assert.equal("documents" in sanitizeEscrow(ESCROW(), ADMIN, ADMIN), false);
    const disputed = ESCROW({ status: "Disputed", dispute: { statement: "x", evidence: [] } });
    assert.equal("documents" in sanitizeEscrow(disputed, ADMIN, ADMIN), false);
  });

  it("gives anonymous callers and outsiders no documents", () => {
    assert.equal("documents" in sanitizeEscrow(ESCROW(), null, ADMIN), false);
    assert.equal("documents" in sanitizeEscrow(ESCROW(), "", ADMIN), false);
    assert.equal("documents" in sanitizeEscrow(ESCROW(), OUTSIDER, ADMIN), false);
  });

  it("does not mutate the stored escrow", () => {
    const stored = ESCROW();
    sanitizeEscrow(stored, BUYER, ADMIN);
    sanitizeEscrow(stored, OUTSIDER, ADMIN);
    assert.equal(stored.documents.length, 1);
    assert.equal(stored.documents[0].blobUrl.startsWith("https://"), true);
  });
});

describe("removing a document", () => {
  const open = () => ESCROW({ status: "Funds Locked", sellerWallet: SELLER });

  it("lets a party remove their own file while the deal is open", () => {
    assert.equal(canRemoveDocument(open(), BUYER, STORED({ side: "buyer" })), true);
    assert.equal(canRemoveDocument(open(), SELLER, STORED({ side: "seller" })), true);
  });

  it("does not let a party remove the other party's file", () => {
    assert.equal(canRemoveDocument(open(), SELLER, STORED({ side: "buyer" })), false);
    assert.equal(canRemoveDocument(open(), BUYER, STORED({ side: "seller" })), false);
  });

  it("does not let the admin or an outsider remove anything", () => {
    assert.equal(canRemoveDocument(open(), ADMIN, STORED({ side: "buyer" })), false);
    assert.equal(canRemoveDocument(open(), OUTSIDER, STORED({ side: "buyer" })), false);
  });

  it("does not allow removing once the deal is disputed or finished", () => {
    for (const status of ["Disputed", "Released", "Refunded", "Cancelled", "Rejected"]) {
      assert.equal(canRemoveDocument(ESCROW({ status, sellerWallet: SELLER }), BUYER, STORED({ side: "buyer" })), false, status);
    }
  });

  it("does not remove the same file twice", () => {
    const gone = removedDocument(STORED({ side: "buyer" }), "buyer", 1700000001000);
    assert.equal(canRemoveDocument(open(), BUYER, gone), false);
    assert.equal(isRemoved(gone), true);
    assert.equal(isRemoved(STORED()), false);
  });

  it("clears the stored copy but keeps the name, who removed it and when", () => {
    const gone = removedDocument(STORED({ side: "buyer" }), "buyer", 1700000001000);
    assert.equal(gone.path, "");
    assert.equal(gone.blobUrl, "");
    assert.equal(gone.removedBy, "buyer");
    assert.equal(gone.removedAt, 1700000001000);
    assert.equal(gone.name, "agreement.pdf");
    assert.equal(gone.hash, "abc123");
  });

  it("shows a removed file to the API as a marker only", () => {
    const gone = removedDocument(STORED({ side: "buyer" }), "buyer", 1700000001000);
    const [doc] = publicDocuments(ESCROW({ documents: [gone] }));
    assert.deepEqual(Object.keys(doc).sort(), ["id", "name", "removedAt", "removedBy", "side"]);
  });

  it("frees a slot when a file is removed", () => {
    const docs = [STORED({ id: "a" }), STORED({ id: "b" }), removedDocument(STORED({ id: "c" }), "buyer")];
    assert.equal(documentSlotsLeft(ESCROW({ documents: docs }), "buyer"), MAX_DEAL_DOCUMENTS_PER_SIDE - 2);
  });

  it("keeps showing the marker to the other party through sanitizeEscrow, never to the admin", () => {
    const gone = removedDocument(STORED({ side: "buyer" }), "buyer", 1700000001000);
    const escrow = ESCROW({ documents: [gone, STORED({ id: "b", side: "buyer" })] });
    const forSeller = sanitizeEscrow(escrow, SELLER, ADMIN).documents;
    assert.equal(forSeller.length, 2);
    assert.equal(forSeller[0].removedBy, "buyer");
    assert.equal("documents" in sanitizeEscrow(escrow, ADMIN, ADMIN), false);
  });
});
