import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api from "../services/api";
import { getConnectedWallet } from "../services/wallet";
import { openDisputeOnChain } from "../services/proofpayContract";

const MAX_SIZE = 2 * 1024 * 1024;

function readFiles(files) {
  return Promise.all([...files].map((file) => new Promise((resolve, reject) => {
    if (file.size > MAX_SIZE) return reject(new Error(`${file.name} is larger than 2 MB.`));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  })));
}

export default function Dispute() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const order = state?.order;
  const [reason, setReason] = useState("Item or service not received");
  const [statement, setStatement] = useState("");
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true); setError("");
      setStatus("Preparing evidence...");
      const preparedFiles = await readFiles(files);
      setStatus("Confirm the dispute transaction in your wallet. Funds remain in escrow.");
      const transactionHash = await openDisputeOnChain(order.escrowId, order.assetSymbol);
      setStatus("Saving private evidence...");
      await api.post(`/escrow/${order.escrowId}/dispute`, {
        wallet: getConnectedWallet(), reason, statement, files: preparedFiles, transactionHash,
      });
      setStatus("The funds are frozen and ProofPay admin will review the case after the other side responds.");
      setSubmitted(true);
    } catch (submitError) {
      setStatus(""); setError(submitError.response?.data?.message || submitError.message || "Unable to open dispute.");
    } finally { setSaving(false); }
  }

  if (!order) return <div className="min-h-screen bg-slate-100"><Navbar /><main className="mx-auto max-w-xl p-8"><p className="rounded-xl bg-red-50 p-4 text-red-700">Open a dispute from an active escrow.</p></main></div>;
  return <div className="min-h-screen bg-slate-100"><Navbar /><main className="mx-auto max-w-2xl px-5 py-8 sm:px-6">
    <button onClick={() => navigate(-1)} className="text-sm font-semibold text-blue-700">← Back to active orders</button>
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-3xl font-bold text-slate-900">Open dispute</h1>
      <p className="mt-2 text-slate-600">{order.escrowId} · Assets stay locked in the escrow contract. Only ProofPay admin can resolve the case.</p>
      {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}
      {submitted ? (
        <div className="mt-6 rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
          <div className="text-5xl">✅</div>
          <h2 className="mt-4 text-2xl font-bold text-green-900">Dispute opened</h2>
          <p className="mt-2 text-sm text-green-800">{status}</p>
          <button onClick={() => navigate(-1)} className="mt-6 rounded-xl bg-green-600 px-6 py-3 font-semibold text-white hover:bg-green-700">← Back to active orders</button>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-5">
          {status && <p className="rounded-xl bg-blue-50 p-3 text-blue-800">{status}</p>}
          <label className="block font-semibold">Reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="mt-2 w-full rounded-xl border p-3 font-normal"><option>Item or service not received</option><option>Item or service differs from agreement</option><option>Delivery is disputed</option><option>Payment not released by buyer</option><option>Other</option></select></label>
          <label className="block font-semibold">Explain what happened<textarea required value={statement} onChange={(event) => setStatement(event.target.value)} rows="6" className="mt-2 w-full rounded-xl border p-3 font-normal" placeholder="Include dates, agreement details, and what you want reviewed." /></label>
          <label className="block font-semibold">Evidence <span className="font-normal text-slate-500">(optional)</span><input multiple accept=".jpg,.jpeg,.png,.webp,.pdf" type="file" onChange={(event) => setFiles([...event.target.files])} className="mt-2 block w-full cursor-pointer text-sm font-normal text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700" /><span className="mt-1 block text-xs font-normal text-slate-500">Maximum 5 JPG, PNG, WEBP, or PDF files; 2 MB each. A written explanation alone is enough to open the case.</span></label>
          {files.length > 0 && <ul className="rounded-xl bg-slate-50 p-3 text-sm">{files.map((file) => <li key={file.name}>• {file.name}</li>)}</ul>}
          <button disabled={saving} className="w-full rounded-xl bg-red-600 py-3 font-semibold text-white disabled:bg-red-300">{saving ? "Opening dispute..." : "Open dispute and freeze funds"}</button>
        </form>
      )}
    </div>
  </main></div>;
}
