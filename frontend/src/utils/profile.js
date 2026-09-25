import api from "../services/api";

const NAME_PREFIX = "proofpay-profile-name:";
const EMAIL_PREFIX = "proofpay-profile-email:";

function readKey(prefix, address) {
  if (!address) return "";

  try {
    return localStorage.getItem(prefix + address.toLowerCase()) || "";
  } catch {
    return "";
  }
}

function writeKey(prefix, address, value) {
  if (!address) return;

  try {
    const trimmed = (value || "").trim();

    if (trimmed) {
      localStorage.setItem(prefix + address.toLowerCase(), trimmed);
    } else {
      localStorage.removeItem(prefix + address.toLowerCase());
    }
  } catch {
    // localStorage may be unavailable (private mode); the value simply
    // will not be remembered for next time.
  }
}

export function getProfileName(address) {
  return readKey(NAME_PREFIX, address);
}

export function setProfileName(address, name) {
  writeKey(NAME_PREFIX, address, name);
  queueServerPush(address);
}

export function getProfileEmail(address) {
  return readKey(EMAIL_PREFIX, address);
}

export function setProfileEmail(address, email) {
  writeKey(EMAIL_PREFIX, address, email);
  queueServerPush(address);
}

// ---------------------------------------------------------------------------
// Server sync. The profile used to live only in one browser's localStorage, so
// a new browser/device asked for the name again. The server copy (keyed by the
// wallet in the signed-in session) is now the source of truth; localStorage is
// a fast local cache that the rest of the app keeps reading synchronously.
// ---------------------------------------------------------------------------

// Address inside the session JWT (not for security -- the server decides that
// -- only to avoid pushing one wallet's profile into another wallet's session).
function sessionJwtAddress() {
  try {
    const token = localStorage.getItem("proofpay-jwt");
    if (!token) return "";
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (payload.exp && payload.exp * 1000 < Date.now()) return "";
    return String(payload.address || "").toLowerCase();
  } catch {
    return "";
  }
}

// Remember which exact name/email the server is known to hold, so disconnect
// only clears this browser's copy when nothing would be lost.
const SERVER_OK_PREFIX = "proofpay-profile-server-ok:";
function markServerCopy(address, name, email) {
  try {
    localStorage.setItem(SERVER_OK_PREFIX + address.toLowerCase(), `${name || ""}\n${email || ""}`);
  } catch { /* ignore */ }
}

const isSignedInAs = (address) => Boolean(address) && sessionJwtAddress() === address.toLowerCase();

// Make sure there is a valid session for this wallet. A Circle (email) wallet
// can get one silently -- it is a server check of its own login, no popup. A
// MetaMask/Rabby wallet needs a signature popup, so that only happens when the
// user asked for something (interactive), never in the background. Errors
// (e.g. "Circle session expired, sign in with email again") are passed on.
async function ensureSession(address, { interactive }) {
  if (isSignedInAs(address)) return true;
  const isCircle = localStorage.getItem("proofpay-wallet-type") === "circle";
  if (!isCircle && !interactive) return false;
  const { connectWalletWithOptions } = await import("../services/wallet");
  await connectWalletWithOptions({ requireSignature: true });
  return isSignedInAs(address);
}

// Explicit save (Profile page): sends exactly what is stored locally, empty
// fields included, so clearing a field clears it on the server too.
export async function saveProfileToServer(address) {
  if (!(await ensureSession(address, { interactive: true }))) {
    throw new Error("Please reconnect your wallet, then save again.");
  }
  const name = getProfileName(address);
  const email = getProfileEmail(address);
  await api.put("/profile", { name, email });
  markServerCopy(address, name, email);
}

// Pull the server profile into localStorage. Non-empty server values win;
// a field that only exists locally (e.g. saved before this feature) is kept
// and uploaded, so nothing an existing user typed is lost.
const syncInFlight = new Map();
export function syncProfileFromServer(address, options = {}) {
  // Getting a session fires "jwt-ready", which asks for a sync too -- share
  // one run per wallet (never across wallets).
  const key = String(address || "").toLowerCase();
  if (!syncInFlight.has(key)) {
    syncInFlight.set(key, runSync(address, options).finally(() => syncInFlight.delete(key)));
  }
  return syncInFlight.get(key);
}

async function runSync(address, { force = false } = {}) {
  if (!address) return null;
  const flag = `proofpay-profile-synced:${address.toLowerCase()}`;
  const tried = `proofpay-profile-session-tried:${address.toLowerCase()}`;
  try {
    if (!force && sessionStorage.getItem(flag)) return null;
  } catch { /* sessionStorage unavailable: just sync */ }

  if (!isSignedInAs(address)) {
    // Try to get a session once per browser session in the background (Circle
    // only); do not retry on every page change if it keeps failing.
    try {
      if (sessionStorage.getItem(tried)) return null;
      sessionStorage.setItem(tried, "1");
    } catch { /* ignore */ }
    if (!(await ensureSession(address, { interactive: false }))) return null;
  }

  const { data } = await api.get("/profile", { _skipReauth: true });
  const server = data.profile || { name: "", email: "" };
  const merged = {
    name: server.name || getProfileName(address),
    email: server.email || getProfileEmail(address),
  };
  writeKey(NAME_PREFIX, address, merged.name);
  writeKey(EMAIL_PREFIX, address, merged.email);
  if (merged.name !== server.name || merged.email !== server.email) {
    await api.put("/profile", merged, { _skipReauth: true });
  }
  markServerCopy(address, merged.name, merged.email);
  try { sessionStorage.setItem(flag, "1"); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent("proofpay:profile-synced"));
  return merged;
}

// setProfileName/Email are called from several pages right after each other;
// push once, shortly after the last one, so every existing call site saves to
// the account without changes.
let pushTimer = null;
function queueServerPush(address) {
  if (!isSignedInAs(address)) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const name = getProfileName(address);
    const email = getProfileEmail(address);
    api.put("/profile", { name, email }, { _skipReauth: true })
      .then(() => markServerCopy(address, name, email))
      .catch(() => { /* local copy is kept; the next sync/save retries */ });
  }, 400);
}
