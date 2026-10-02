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

export async function fetchActivity() {
  const response = await api.get("/activity");
  return response.data.activity || [];
}
