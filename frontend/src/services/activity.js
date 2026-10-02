import api from "./api";

// Swap / Bridge history. Recording is a courtesy to the user's own history
// page, so a failure here must never surface as a failed swap or bridge --
// the funds have already moved by the time this runs.
export async function recordActivity(entry) {
  try {
    await api.post("/activity", { ...entry, clientId: crypto.randomUUID() });
  } catch {
    // The history page just won't list this one.
  }
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
  const response = await api.get("/activity");
  return response.data.activity || [];
}
