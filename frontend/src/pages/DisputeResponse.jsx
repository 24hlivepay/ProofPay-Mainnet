import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api, { API_BASE_URL } from "../services/api";
import { getConnectedWallet } from "../services/wallet";

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

export default function DisputeResponse() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const order = state?.order;
  const wallet = getConnectedWallet();
  const [dispute, setDispute] = useState(null);
  const [statement, setStatement] = useState("");
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!order) return;
    api.get(`/escrow/${order.escrowId}/dispute`, { params: { wallet } })
      .then((response) => setDispute(response.data.dispute))
      .catch((loadError) => setError(loadError.response?.data?.message || "Unable to load this dispute."))
      .finally(() => setLoading(false));
  }, [order, wallet]);

  const mySide = order && wallet?.toLowerCase() === order.buyerWallet?.toLowerCase() ? "buyer" : "seller";
  const isOpener = dispute && mySide === dispute.openedBySide;
  const alreadyResponded = dispute?.responses?.some((response) => response.side === mySide);
  const resolution = dispute?.resolution;

  async function submit(event) {
    event.preventDefault();
    try {
      setSaving(true); setError("");
      const response = await api.post(`/escrow/${order.escrowId}/dispute/response`, {
        wallet, statement, files: await readFiles(files),
      });
      setDispute(response.data.escrow.dispute);
      setStatus("Response submitted. ProofPay admin will review both sides and settle the escrow on-chain.");
    } catch (submitError) {
      setError(submitError.response?.data?.message || submitError.message || "Unable to submit response.");
    } finally { setSaving(false); }
  }

  if (!order) return <div className="min-h-screen bg-slate-100"><Navbar /><main className="mx-auto max-w-xl p-8"><p className="rounded-xl bg-red-50 p-4 text-red-700">Open this screen from an active, disputed escrow.</p></main></div>;

  const canRespond = dispute && !isOpener && !alreadyResponded && !resolution;
  const title = canRespond ? "Respond to dispute" : "Dispute case";

  return <div className="min-h-screen bg-slate-100"><Navbar /><main className="mx-auto max-w-2xl px-5 py-8 sm:px-6">
    <button onClick={() => navigate(-1)} className="text-sm font-semibold text-blue-700">← Back to active orders</button>
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <h1 className="text-3xl font-bold text-slate-900">{title}</h1>
      <p className="mt-2 text-slate-600">{order.escrowId} · Funds stay locked in the escrow contract until ProofPay admin resolves the case.</p>

      {loading && <p className="mt-6 text-slate-600">Loading case details...</p>}
      {error && <p className="mt-5 rounded-xl bg-red-50 p-3 text-red-700">{error}</p>}

      <div className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Buyer</p><p className="font-semibold text-slate-900">{order.buyerName || "—"}</p><p className="break-all text-xs text-slate-500">{order.buyerWallet}</p></div>
        <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Seller</p><p className="font-semibold text-slate-900">{order.sellerName || "—"}</p><p className="break-all text-xs text-slate-500">{order.sellerWallet}</p></div>
      </div>

      {dispute && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="font-bold text-slate-900">{dispute.openedBySide === "buyer" ? "Buyer" : "Seller"} claim</h2>
        <p className="mt-1 text-sm font-semibold text-slate-700">{dispute.reason}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{dispute.statement}</p>
        {dispute.evidence?.length > 0 && <ul className="mt-3 text-sm">
          {dispute.evidence.map((file) => <li key={file.id}>
            <a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`${API_BASE_URL}/escrow/${order.escrowId}/dispute/evidence/${file.id}?wallet=${encodeURIComponent(wallet)}`}>{file.name}</a>
          </li>)}
        </ul>}
      </div>}

      {dispute?.responses?.map((response, index) => <div key={index} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h2 className="font-bold text-slate-900">{response.side === "buyer" ? "Buyer" : "Seller"} response</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{response.statement}</p>
        {response.evidence?.length > 0 && <ul className="mt-3 text-sm">
          {response.evidence.map((file) => <li key={file.id}>
            <a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`${API_BASE_URL}/escrow/${order.escrowId}/dispute/evidence/${file.id}?wallet=${encodeURIComponent(wallet)}`}>{file.name}</a>
          </li>)}
        </ul>}
      </div>)}

      {resolution && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
        <h2 className="font-bold text-green-900">ProofPay admin decision</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-green-800">{resolution.note}</p>
        <p className="mt-3 text-sm font-semibold text-green-900">
          {resolution.buyerAmount} {order.assetSymbol} to buyer · {resolution.sellerAmount} {order.assetSymbol} to seller
        </p>
        <a className="mt-2 inline-block text-sm font-semibold text-blue-700 underline" target="_blank" rel="noreferrer" href={`https://testnet.arcscan.app/tx/${resolution.transactionHash}`}>View settlement on Arcscan ↗</a>
      </div>}

      {status && <p className="mt-5 rounded-xl bg-blue-50 p-3 text-blue-800">{status}</p>}

      {dispute && !status && !resolution && (isOpener
        ? <p className="mt-6 rounded-xl bg-blue-50 p-4 text-blue-800">Waiting for the other party to respond. ProofPay admin will review both sides once they do.</p>
        : alreadyResponded
          ? <p className="mt-6 rounded-xl bg-blue-50 p-4 text-blue-800">You already submitted a response. ProofPay admin is reviewing both sides.</p>
          : <form onSubmit={submit} className="mt-6 space-y-5">
            <label className="block font-semibold">Your response<textarea required value={statement} onChange={(event) => setStatement(event.target.value)} rows="6" className="mt-2 w-full rounded-xl border p-3 font-normal" placeholder="Explain your side and reference dates or delivery details." /></label>
            <label className="block font-semibold">Evidence <span className="font-normal text-slate-500">(optional)</span><input multiple accept=".jpg,.jpeg,.png,.webp,.pdf" type="file" onChange={(event) => setFiles([...event.target.files])} className="mt-2 block w-full cursor-pointer text-sm font-normal text-slate-600 file:mr-4 file:cursor-pointer file:rounded-lg file:border-0 file:bg-blue-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-700" /><span className="mt-1 block text-xs font-normal text-slate-500">Maximum 5 JPG, PNG, WEBP, or PDF files; 2 MB each. A written explanation alone is enough.</span></label>
            {files.length > 0 && <ul className="rounded-xl bg-slate-50 p-3 text-sm">{files.map((file) => <li key={file.name}>• {file.name}</li>)}</ul>}
            <button disabled={saving} className="w-full rounded-xl bg-blue-600 py-3 font-semibold text-white disabled:bg-blue-300">{saving ? "Submitting response..." : "Submit response"}</button>
          </form>)}
    </div>
  </main></div>;
}
