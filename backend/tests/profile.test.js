/**
 * Profile (name + email) tests. node:test, no env vars.
 * Run: node --test tests/profile.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeProfile, getProfile, saveProfile, MAX_NAME_LENGTH } from "../lib/profile.js";

describe("sanitizeProfile", () => {
  it("trims and accepts a valid name + email", () => {
    const { profile } = sanitizeProfile({ name: "  Atif Najam ", email: " a@b.co " });
    assert.deepEqual(profile, { name: "Atif Najam", email: "a@b.co" });
  });

  it("allows clearing a field with an empty string", () => {
    assert.deepEqual(sanitizeProfile({ name: "", email: "" }).profile, { name: "", email: "" });
  });

  it("rejects an invalid email", () => {
    assert.ok(sanitizeProfile({ name: "x", email: "not-an-email" }).error);
  });

  it("rejects an over-long name", () => {
    assert.ok(sanitizeProfile({ name: "n".repeat(MAX_NAME_LENGTH + 1), email: "" }).error);
  });

  it("ignores non-string values and junk bodies instead of throwing", () => {
    assert.deepEqual(sanitizeProfile({ name: { $ne: 1 }, email: 5 }).profile, { name: "", email: "" });
    assert.deepEqual(sanitizeProfile(null).profile, { name: "", email: "" });
    assert.deepEqual(sanitizeProfile("str").profile, { name: "", email: "" });
  });
});

describe("profile storage", () => {
  it("file mode: save then read back, address is case-insensitive", async () => {
    let local = {};
    local = await saveProfile(null, "0xABCdef", { name: "Atif", email: "a@b.co" }, local);
    const got = await getProfile(null, "0xabcDEF", local);
    assert.deepEqual(got, { name: "Atif", email: "a@b.co" });
  });

  it("file mode: one wallet's profile is not returned for another", async () => {
    const local = await saveProfile(null, "0xaaa", { name: "A", email: "" }, {});
    assert.deepEqual(await getProfile(null, "0xbbb", local), { name: "", email: "" });
  });

  it("file mode: saving a second wallet keeps the first", async () => {
    let local = await saveProfile(null, "0xaaa", { name: "A", email: "" }, {});
    local = await saveProfile(null, "0xbbb", { name: "B", email: "" }, local);
    assert.equal((await getProfile(null, "0xaaa", local)).name, "A");
    assert.equal((await getProfile(null, "0xbbb", local)).name, "B");
  });

  it("db mode: upserts under the lowercase address and reads it back", async () => {
    const rows = new Map();
    const db = {
      async query(sql, params) {
        if (/INSERT/i.test(sql)) { rows.set(params[1], JSON.parse(params[2])); return { rows: [] }; }
        return { rows: rows.has(params[1]) ? [{ data: rows.get(params[1]) }] : [] };
      },
    };
    await saveProfile(db, "0xAbC", { name: "Atif", email: "a@b.co" });
    assert.ok(rows.has("0xabc"));
    assert.deepEqual(await getProfile(db, "0xABC"), { name: "Atif", email: "a@b.co" });
    assert.deepEqual(await getProfile(db, "0xother"), { name: "", email: "" });
  });

  it("refuses to save without an address", async () => {
    await assert.rejects(saveProfile(null, "", { name: "x", email: "" }, {}), /address is required/);
  });
});
