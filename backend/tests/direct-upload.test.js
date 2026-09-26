import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DIRECT_UPLOAD_TYPES,
  MAX_DEAL_DOCUMENT_BYTES,
  authorizeDirectUpload,
  parseDealDocumentPathname,
  registerDirectUpload,
} from "../lib/directUpload.js";

const BUYER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SELLER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const ADMIN = "0xcccccccccccccccccccccccccccccccccccccccc";
const OUTSIDER = "0xdddddddddddddddddddddddddddddddddddddddd";
const UUID = "123e4567-e89b-12d3-a456-426614174000";

const ESCROW = (over = {}) => ({
  escrowId: "PP-ABC123DEF4",
  buyerWallet: BUYER,
  sellerWallet: "",
  expectedSeller: SELLER,
  status: "Waiting Seller",
  documents: [],
  ...over,
});
const path = (side = "buyer", id = "PP-ABC123DEF4", ext = "pdf") => `deals/${id}/${side}/${UUID}.${ext}`;

// a fake storage: records what was deleted
function fakeBlob({ pathname, contentType = "application/pdf", size = 5 * 1024 * 1024, headFails = false, hash = "h4sh" } = {}) {
  const deleted = [];
  return {
    deleted,
    head: async () => { if (headFails) throw new Error("not found"); return { pathname, contentType, size }; },
    sha256: async () => hash,
    del: async (url) => { deleted.push(url); },
  };
}

describe("parseDealDocumentPathname", () => {
  it("accepts the exact shape and returns its parts", () => {
    assert.deepEqual(parseDealDocumentPathname(path("seller", "PP-ABC123DEF4", "png")), {
      escrowId: "PP-ABC123DEF4", side: "seller", id: UUID, extension: "png",
    });
  });

  it("rejects anything else", () => {
    for (const bad of [
      "", null, undefined, "deals/PP-1/admin/" + UUID + ".pdf", `deals/PP-1/buyer/${UUID}.exe`,
      `deals/PP-1/buyer/../${UUID}.pdf`, `evidence/PP-1/buyer/${UUID}.pdf`, `deals/PP-1/buyer/not-a-uuid.pdf`,
      `deals/PP 1/buyer/${UUID}.pdf`, `/deals/PP-1/buyer/${UUID}.pdf`, `deals/PP-1/buyer/${UUID}.pdf/extra`,
    ]) {
      assert.equal(parseDealDocumentPathname(bad), null, String(bad));
    }
  });
});

describe("authorizeDirectUpload", () => {
  it("allows the buyer and the pinned seller for their own path on an open deal", () => {
    assert.deepEqual(authorizeDirectUpload({ escrow: ESCROW(), wallet: BUYER, pathname: path("buyer") }), { ok: true, side: "buyer" });
    assert.deepEqual(authorizeDirectUpload({ escrow: ESCROW(), wallet: SELLER, pathname: path("seller") }), { ok: true, side: "seller" });
  });

  it("refuses the admin, an outsider and a missing deal", () => {
    assert.equal(authorizeDirectUpload({ escrow: ESCROW(), wallet: ADMIN, pathname: path("buyer") }).status, 403);
    assert.equal(authorizeDirectUpload({ escrow: ESCROW(), wallet: OUTSIDER, pathname: path("buyer") }).status, 403);
    assert.equal(authorizeDirectUpload({ escrow: null, wallet: BUYER, pathname: path("buyer") }).status, 404);
  });

  it("refuses a path for the other side or for another deal", () => {
    assert.equal(authorizeDirectUpload({ escrow: ESCROW(), wallet: BUYER, pathname: path("seller") }).status, 400);
    assert.equal(authorizeDirectUpload({ escrow: ESCROW(), wallet: BUYER, pathname: path("buyer", "PP-OTHER00001") }).status, 400);
    assert.equal(authorizeDirectUpload({ escrow: ESCROW(), wallet: BUYER, pathname: "anything/else.pdf" }).status, 400);
  });

  it("refuses once the deal is disputed or finished", () => {
    for (const status of ["Disputed", "Released", "Refunded", "Cancelled", "Rejected"]) {
      assert.equal(authorizeDirectUpload({ escrow: ESCROW({ status }), wallet: BUYER, pathname: path("buyer") }).status, 400, status);
    }
  });

  it("refuses when the side already has the maximum number of files", () => {
    const docs = Array.from({ length: 5 }, (_, i) => ({ id: `d${i}`, side: "buyer" }));
    assert.equal(authorizeDirectUpload({ escrow: ESCROW({ documents: docs }), wallet: BUYER, pathname: path("buyer") }).status, 400);
    // a removed file frees a slot
    docs[0].removedAt = 1;
    assert.equal(authorizeDirectUpload({ escrow: ESCROW({ documents: docs }), wallet: BUYER, pathname: path("buyer") }).ok, true);
  });
});

describe("registerDirectUpload", () => {
  const args = (over = {}) => ({ escrow: ESCROW(), wallet: BUYER, pathname: path("buyer"), url: "https://store.example/deal.pdf", name: "agreement.pdf", ...over });

  it("records a file that really is in storage, from what storage says", async () => {
    const blob = fakeBlob({ pathname: path("buyer"), size: 7 * 1024 * 1024 });
    const result = await registerDirectUpload({ ...args(), blob, now: 1700000000000, newId: () => "doc-1" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.document, {
      id: "doc-1", side: "buyer", name: "agreement.pdf", type: "application/pdf", size: 7 * 1024 * 1024,
      path: "", blobUrl: "https://store.example/deal.pdf", blobPathname: path("buyer"), hash: "h4sh", uploadedAt: 1700000000000,
    });
    assert.deepEqual(blob.deleted, []);
  });

  it("allows exactly 10 MB and refuses one byte more, deleting the file", async () => {
    const ok = await registerDirectUpload({ ...args(), blob: fakeBlob({ pathname: path("buyer"), size: MAX_DEAL_DOCUMENT_BYTES }) });
    assert.equal(ok.ok, true);
    const blob = fakeBlob({ pathname: path("buyer"), size: MAX_DEAL_DOCUMENT_BYTES + 1 });
    const bad = await registerDirectUpload({ ...args(), blob });
    assert.equal(bad.ok, false);
    assert.deepEqual(blob.deleted, ["https://store.example/deal.pdf"]);
  });

  it("refuses and deletes a wrong type, an empty file, and a file at a different path", async () => {
    for (const over of [{ contentType: "text/html" }, { size: 0 }, { pathname: path("buyer", "PP-OTHER00001") }]) {
      const blob = fakeBlob({ pathname: path("buyer"), ...over });
      const result = await registerDirectUpload({ ...args(), blob });
      assert.equal(result.ok, false, JSON.stringify(over));
      assert.equal(blob.deleted.length, 1, JSON.stringify(over));
    }
    assert.ok(DIRECT_UPLOAD_TYPES.includes("application/pdf"));
  });

  it("refuses when the file is not in storage", async () => {
    const result = await registerDirectUpload({ ...args(), blob: fakeBlob({ headFails: true }) });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  });

  it("refuses the same file twice, and unauthorized callers, without touching storage", async () => {
    const blob = fakeBlob({ pathname: path("buyer") });
    const twice = await registerDirectUpload({ ...args({ escrow: ESCROW({ documents: [{ id: "x", side: "buyer", blobPathname: path("buyer") }] }) }), blob });
    assert.equal(twice.ok, false);
    const outsider = await registerDirectUpload({ ...args({ wallet: OUTSIDER }), blob });
    assert.equal(outsider.status, 403);
    const admin = await registerDirectUpload({ ...args({ wallet: ADMIN }), blob });
    assert.equal(admin.status, 403);
    assert.deepEqual(blob.deleted, []);
  });

  it("cuts a long name to 120 characters", async () => {
    const blob = fakeBlob({ pathname: path("buyer") });
    const result = await registerDirectUpload({ ...args({ name: "x".repeat(300) }), blob });
    assert.equal(result.document.name.length, 120);
  });
});
