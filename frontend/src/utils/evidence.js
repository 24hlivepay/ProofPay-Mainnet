import api from "../services/api";

export const MAX_EVIDENCE_BYTES = 2 * 1024 * 1024;

export function readEvidenceFiles(files) {
  return Promise.all([...files].map((file) => new Promise((resolve, reject) => {
    if (file.size > MAX_EVIDENCE_BYTES) return reject(new Error(`${file.name} is larger than 2 MB.`));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  })));
}

// Evidence is private: the endpoint needs the session token, which a plain
// <a href> navigation cannot send. Fetch it through the authenticated client
// and open the resulting blob instead. The tab is opened synchronously (inside
// the click) so popup blockers allow it, then pointed at the blob.
export async function openEvidence(escrowId, file) {
  const tab = window.open("", "_blank");
  try {
    const response = await api.get(`/escrow/${escrowId}/dispute/evidence/${file.id}`, { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    if (tab) {
      tab.location.href = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name || "evidence";
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    if (tab) tab.close();
    throw new Error(error.response?.status === 403 ? "You do not have access to this file." : "Unable to open this file.");
  }
}
