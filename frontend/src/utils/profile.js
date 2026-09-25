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
    return String(payload.address || "").toLowerCase();
  } catch {
    return "";
  }
}

const isSignedInAs = (address) => Boolean(address) && sessionJwtAddress() === address.toLowerCase();

// Explicit save (Profile page): sends exactly what is stored locally, empty
// fields included, so clearing a field clears it on the server too.
export async function saveProfileToServer(address) {
  if (!isSignedInAs(address)) throw new Error("Please reconnect your wallet, then save again.");
  await api.put("/profile", { name: getProfileName(address), email: getProfileEmail(address) });
}

// Pull the server profile into localStorage. Non-empty server values win;
// a field that only exists locally (e.g. saved before this feature) is kept
// and uploaded, so nothing an existing user typed is lost.
export async function syncProfileFromServer(address, { force = false } = {}) {
  if (!isSignedInAs(address)) return null;
  const flag = `proofpay-profile-synced:${address.toLowerCase()}`;
  try {
    if (!force && sessionStorage.getItem(flag)) return null;
  } catch { /* sessionStorage unavailable: just sync */ }

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
    api.put("/profile", { name: getProfileName(address), email: getProfileEmail(address) }, { _skipReauth: true })
      .catch(() => { /* local copy is kept; the next sync/save retries */ });
  }, 400);
}
