/**
 * backend/lib/profile.js
 *
 * Per-wallet profile (display name + contact email), so it follows the user
 * across browsers instead of living only in one browser's localStorage.
 * Self-contained (no Express) -- imported by server.js and by tests.
 *
 * Stored in proofpay_records (record_type "profile", record_id = lowercase
 * wallet address), or a local JSON file when there is no DATABASE_URL.
 */

const RECORD_TYPE = "profile";
export const MAX_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalize a submitted profile. Returns { profile } or
 * { error }. Both fields are optional individually; an empty string clears.
 */
export function sanitizeProfile(input) {
  const body = input && typeof input === "object" ? input : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Name must be ${MAX_NAME_LENGTH} characters or fewer.` };
  }
  if (email.length > MAX_EMAIL_LENGTH || (email && !EMAIL_PATTERN.test(email))) {
    return { error: "Enter a valid email address." };
  }
  return { profile: { name, email } };
}

export async function getProfile(db, address, localProfiles) {
  const key = String(address || "").toLowerCase();
  if (!key) return { name: "", email: "" };
  if (db) {
    const result = await db.query(
      "SELECT data FROM proofpay_records WHERE record_type = $1 AND record_id = $2",
      [RECORD_TYPE, key]
    );
    const data = result.rows[0]?.data;
    return { name: data?.name || "", email: data?.email || "" };
  }
  const data = (localProfiles || {})[key];
  return { name: data?.name || "", email: data?.email || "" };
}

/** Upserts the profile; returns the local map to write back in file mode. */
export async function saveProfile(db, address, profile, localProfiles) {
  const key = String(address || "").toLowerCase();
  if (!key) throw new Error("A wallet address is required.");
  const record = { name: profile.name, email: profile.email, updatedAt: Date.now() };
  if (db) {
    await db.query(
      `INSERT INTO proofpay_records (record_type, record_id, data, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (record_type, record_id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [RECORD_TYPE, key, JSON.stringify(record)]
    );
    return null;
  }
  return { ...(localProfiles || {}), [key]: record };
}
