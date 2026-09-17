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
}

export function getProfileEmail(address) {
  return readKey(EMAIL_PREFIX, address);
}

export function setProfileEmail(address, email) {
  writeKey(EMAIL_PREFIX, address, email);
}
