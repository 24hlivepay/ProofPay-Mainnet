const PREFIX = "proofpay-profile-name:";

export function getProfileName(address) {
  if (!address) return "";

  try {
    return localStorage.getItem(PREFIX + address.toLowerCase()) || "";
  } catch {
    return "";
  }
}

export function setProfileName(address, name) {
  if (!address) return;

  try {
    const trimmed = (name || "").trim();

    if (trimmed) {
      localStorage.setItem(PREFIX + address.toLowerCase(), trimmed);
    } else {
      localStorage.removeItem(PREFIX + address.toLowerCase());
    }
  } catch {
    // localStorage may be unavailable (private mode); the name simply
    // will not be remembered for next time.
  }
}
