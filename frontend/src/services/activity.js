import api from "./api";
import { getCurrentNetworkId } from "../config/network";
import { getWalletSession } from "./wallet";

// Swap / Bridge history. Recording is a courtesy to the user's own history
// page, so a failure here must never surface as a failed swap or bridge --
// the funds have already moved by the time this runs. It also must never open
// a wallet signature popup on its own: after a 2 hour session the first call
// that needs the login used to ask for a fresh sign-in at the very end of a
// swap. A record the server turned away for that reason is kept in this
// browser and sent the next time the History page is opened, when signing in
// is expected. The server ignores a repeated clientId, so a resend is safe.
const PENDING_KEY = "proofpay-pending-activity";
const MAX_PENDING = 20;

function readPending() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writePending(list) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
  } catch {
    // Storage blocked: the record is simply not kept.
  }
}

function currentWallet() {
  return String(getWalletSession()?.address || "").toLowerCase();
}

export async function recordActivity(entry) {
  const body = { ...entry, clientId: crypto.randomUUID() };
  try {
    await api.post("/activity", body, { _skipReauth: true });
  } catch (error) {
    const wallet = currentWallet();
    if (error.response?.status === 401 && wallet) {
      writePending([...readPending(), { wallet, network: getCurrentNetworkId(), body }]);
    }
  }
}

// Sends the kept records of this wallet and network. True if any went through.
async function sendPending() {
  const wallet = currentWallet();
  const network = getCurrentNetworkId();
  const all = readPending();
  const mine = all.filter((item) => item.wallet === wallet && item.network === network);
  if (!wallet || mine.length === 0) return false;

  const stillPending = [];
  for (const item of mine) {
    try {
      await api.post("/activity", item.body, { _skipReauth: true });
    } catch {
      stillPending.push(item);
    }
  }
  writePending([...all.filter((item) => !mine.includes(item)), ...stillPending]);
  return stillPending.length < mine.length;
}

// A plain decimal string the server accepts (no exponent, at most 8 places,
// no trailing zeros): 6.8e-7 becomes "0.00000068".
export function plainAmount(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return number.toFixed(8).replace(/\.?0+$/, "") || "0";
}

export async function fetchActivity() {
  // This call may ask for the sign-in; on the History page that is expected.
  let response = await api.get("/activity");
  if (await sendPending()) response = await api.get("/activity");
  return response.data.activity || [];
}
