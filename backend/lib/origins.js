/**
 * backend/lib/origins.js
 *
 * Which browser origins may call the API. Self-contained (no Express) --
 * imported by server.js and by tests.
 *
 * This used to accept every https://*.vercel.app origin, i.e. any site hosted
 * on Vercel by anyone. It now accepts only ProofPay's own addresses:
 *   - the production domains and local development,
 *   - the exact hosts Vercel reports for this deployment (its own URL, its
 *     branch alias and the project's production URL),
 *   - and, as a fallback for previews, hosts shaped like this project's own
 *     preview URLs: proof-pay-<something>-proof-pay.vercel.app.
 *
 * CORS is not what protects the data -- every privileged route needs a
 * signed session -- so this only narrows which pages a browser lets talk to
 * the API at all.
 */

const FIXED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://proofpay.online",
  "https://www.proofpay.online",
  // The project's original Vercel address, still served.
  "https://proof-pay-mu.vercel.app",
];

// proof-pay-<hash or git-branch>-proof-pay.vercel.app: project name first,
// team slug last.
const PROJECT_PREVIEW = /^https:\/\/proof-pay-[a-z0-9-]+-proof-pay\.vercel\.app$/;

function originOf(value) {
  if (!value) return null;
  const text = String(value).trim().replace(/\/+$/, "");
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text.toLowerCase() : `https://${text.toLowerCase()}`;
}

/** The exact origins allowed for this deployment, from its environment. */
export function allowedOriginsFromEnv(env = process.env) {
  return [
    ...FIXED_ORIGINS,
    originOf(env.FRONTEND_URL),
    originOf(env.VERCEL_URL),
    originOf(env.VERCEL_BRANCH_URL),
    originOf(env.VERCEL_PROJECT_PRODUCTION_URL),
  ].filter(Boolean);
}

/**
 * True when a request may proceed. A request with no Origin header is not a
 * cross-site browser call (same-origin GETs, curl, server-to-server), so it
 * is allowed, as before.
 */
export function isAllowedOrigin(origin, allowed = allowedOriginsFromEnv()) {
  if (!origin) return true;
  const value = String(origin).toLowerCase();
  return allowed.includes(value) || PROJECT_PREVIEW.test(value);
}
