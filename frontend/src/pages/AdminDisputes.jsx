import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import api, { API_BASE_URL } from "../services/api";
import { getConnectedWallet } from "../services/wallet";
import { resolveDisputeOnChain } from "../services/proofpayContract";

export default function AdminDisputes() {
  const navigate = useNavigate();
  const [cases, setCases] = useState([]); const [resolved, setResolved] = useState([]); const [error, setError] = useState(""); const [busy, setBusy] = useState("");
  const wallet = getConnectedWallet();
  const load = () => api.get("/admin/disputes", { params: { wallet } })
    .then((r) => { setCases(r.data.disputes); setResolved(r.data.resolved || []); })
    .catch((e) => setError(e.response?.data?.message || "Unable to load cases."));
  useEffect(() => { load(); }, []);
  async function resolve(escrow, buyerAmount, note) {
    if (!note.trim()) return setError("Write a resolution note before deciding — both sides will see it.");
    try { setBusy(escrow.escrowId); setError("");
      const transactionHash = await resolveDisputeOnChain(escrow.escrowId, buyerAmount, escrow.assetSymbol);
      await api.post(`/admin/disputes/${escrow.escrowId}/resolved`, { wallet, buyerAmount, transactionHash, note });
      load();
    } catch (e) { setError(e.response?.data?.message || e.message || "Resolution failed."); } finally { setBusy(""); }
  }
  return <div className="min-h-screen bg-slate-100"><Navbar /><main className="mx-auto max-w-5xl px-5 py-8"><button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">← Back to Dashboard</button><h1 className="mt-4 text-3xl font-bold text-slate-900">ProofPay dispute administration</h1><p className="mt-2 text-slate-600">Funds are held by the contract. Your resolution transaction sends them directly to the buyer and/or seller.</p>{error && <p className="mt-5 rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}<div className="mt-8 space-y-6">{cases.length === 0 && <p className="rounded-2xl bg-white p-8 text-slate-600">No active disputes.</p>}{cases.map((escrow) => <Case key={escrow.escrowId} escrow={escrow} wallet={wallet} busy={busy === escrow.escrowId} resolve={resolve} />)}</div>{resolved.length > 0 && <div className="mt-12"><h2 className="text-2xl font-bold text-slate-900">Resolved disputes</h2><p className="mt-1 text-slate-600">Your own record of past decisions.</p><div className="mt-4 space-y-4">{resolved.map((escrow) => <ResolvedCase key={escrow.escrowId} escrow={escrow} wallet={wallet} />)}</div></div>}</main></div>;
}

function ResolvedCase({ escrow, wallet }) {
  const dispute = escrow.dispute; const resolution = dispute.resolution;
  const evidence = [...(dispute.evidence || []), ...(dispute.responses || []).flatMap((response) => response.evidence || [])];
  return <article className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-xl font-bold">{escrow.escrowId}</h2><p className="text-slate-600">{escrow.amount} {escrow.assetSymbol} · {dispute.reason}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">Resolved {formatDate(resolution.resolvedAt)}</span></div>

    <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Buyer</p><p className="font-semibold text-slate-900">{escrow.buyerName || "—"}</p><p className="break-all text-xs text-slate-500">{escrow.buyerWallet}</p></div>
      <div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Seller</p><p className="font-semibold text-slate-900">{escrow.sellerName || "—"}</p><p className="break-all text-xs text-slate-500">{escrow.sellerWallet}</p></div>
    </div>

    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <section><h3 className="font-bold">{dispute.openedBySide} claim</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{dispute.statement}</p></section>
      {(dispute.responses || []).map((response, index) => <section key={index}><h3 className="font-bold">{response.side} response</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{response.statement}</p></section>)}
    </div>

    {evidence.length > 0 && <><h3 className="mt-4 font-bold">Private evidence</h3><ul className="mt-2 text-sm">{evidence.map((file) => <li key={file.id}><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`${API_BASE_URL}/escrow/${escrow.escrowId}/dispute/evidence/${file.id}?wallet=${encodeURIComponent(wallet)}`}>{file.side}: {file.name}</a></li>)}</ul></>}

    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
      <p className="font-bold text-green-900">Admin decision</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-green-800">{resolution.note}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="font-semibold text-green-900">{resolution.buyerAmount} to buyer · {resolution.sellerAmount} to seller</p><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`https://testnet.arcscan.app/tx/${resolution.transactionHash}`}>View settlement ↗</a></div>
    </div>
  </article>;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Case({ escrow, wallet, busy, resolve }) {
  const dispute = escrow.dispute; const evidence = [...(dispute.evidence || []), ...(dispute.responses || []).flatMap((response) => response.evidence || [])];
  const [amount, setAmount] = useState(String(escrow.amount));
  const [note, setNote] = useState("");
  const [splitOpen, setSplitOpen] = useState(false);
  const totalAmount = Number(escrow.amount);
  const buyerAmount = Math.min(Math.max(Number(amount) || 0, 0), totalAmount);
  const sellerAmount = totalAmount - buyerAmount;
  const isFullBuyer = buyerAmount === totalAmount;
  const isFullSeller = sellerAmount === totalAmount;
  return <article className="rounded-2xl border border-red-200 bg-white p-6 shadow-sm"><div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-bold">{escrow.escrowId}</h2><p className="text-slate-600">{escrow.amount} {escrow.assetSymbol} · {dispute.status}</p></div><span className="rounded-full bg-red-100 px-3 py-1 font-bold text-red-700">{dispute.reason}</span></div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Buyer</p><p className="font-semibold text-slate-900">{escrow.buyerName || "—"}</p><p className="break-all text-xs text-slate-500">{escrow.buyerWallet}</p></div><div className="rounded-xl border border-slate-200 p-3"><p className="text-slate-500">Seller</p><p className="font-semibold text-slate-900">{escrow.sellerName || "—"}</p><p className="break-all text-xs text-slate-500">{escrow.sellerWallet}</p></div></div><div className="mt-4 grid gap-4 md:grid-cols-2"><section><h3 className="font-bold">{dispute.openedBySide} claim</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{dispute.statement}</p></section>{(dispute.responses || []).map((response, index) => <section key={index}><h3 className="font-bold">{response.side} response</h3><p className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{response.statement}</p></section>)}</div><h3 className="mt-5 font-bold">Private evidence</h3><ul className="mt-2 text-sm">{evidence.map((file) => <li key={file.id}><a className="text-blue-700 underline" target="_blank" rel="noreferrer" href={`${API_BASE_URL}/escrow/${escrow.escrowId}/dispute/evidence/${file.id}?wallet=${encodeURIComponent(wallet)}`}>{file.side}: {file.name}</a></li>)}</ul><div className="mt-6 rounded-xl border border-slate-200 p-4"><label className="block text-sm font-bold">Resolution note <span className="font-normal text-slate-500">(buyer and seller will both see this)</span><textarea required value={note} onChange={(e) => setNote(e.target.value)} rows="3" className="mt-2 w-full rounded-lg border p-2 font-normal" placeholder="Explain the decision and what happens next." /></label><div className="mt-4 grid gap-3 sm:grid-cols-3"><button type="button" disabled={busy} onClick={() => setAmount(String(escrow.amount))} className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">Set: full refund to buyer</button><button type="button" disabled={busy} onClick={() => setAmount("0")} className="rounded-lg border border-green-200 bg-green-50 p-2 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-50">Set: full payment to seller</button><button type="button" disabled={busy} onClick={() => setSplitOpen(true)} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">Split by %...</button></div>{isFullBuyer || isFullSeller ? <div className={`mt-4 rounded-lg border-2 p-4 text-center ${isFullBuyer ? "border-blue-200 bg-blue-50" : "border-green-200 bg-green-50"}`}><p className={`text-xs font-bold uppercase tracking-wide ${isFullBuyer ? "text-blue-700" : "text-green-700"}`}>{isFullBuyer ? "To buyer" : "To seller"}</p><p className={`mt-1 text-3xl font-bold ${isFullBuyer ? "text-blue-900" : "text-green-900"}`}>{isFullBuyer ? buyerAmount : sellerAmount} {escrow.assetSymbol}</p></div> : <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-3 text-center"><p className="text-xs font-bold uppercase tracking-wide text-blue-700">Buyer gets</p><p className="mt-1 text-2xl font-bold text-blue-900">{buyerAmount} {escrow.assetSymbol}</p></div><div className="rounded-lg border-2 border-green-200 bg-green-50 p-3 text-center"><p className="text-xs font-bold uppercase tracking-wide text-green-700">Seller gets</p><p className="mt-1 text-2xl font-bold text-green-900">{sellerAmount} {escrow.assetSymbol}</p></div></div>}<button disabled={busy} onClick={() => resolve(escrow, amount, note)} className="mt-3 w-full rounded-lg bg-red-600 p-3 font-semibold text-white disabled:opacity-50">{busy ? "Resolving..." : "Confirm"}</button></div>{splitOpen && <SplitPercentModal total={Number(escrow.amount)} symbol={escrow.assetSymbol} onApply={(nextAmount) => { setAmount(nextAmount); setSplitOpen(false); }} onClose={() => setSplitOpen(false)} />}</article>;
}

function SplitPercentModal({ total, symbol, onApply, onClose }) {
  const [buyerPercent, setBuyerPercent] = useState("50");
  const percent = Math.min(Math.max(Number(buyerPercent) || 0, 0), 100);
  const buyerAmount = Math.round((total * percent) / 100 * 1e8) / 1e8;
  const sellerAmount = Math.round((total - buyerAmount) * 1e8) / 1e8;
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
        <h3 className="text-xl font-bold text-slate-900">Split by percentage</h3>
        <p className="mt-1 text-sm text-slate-600">Choose the buyer's share; the rest goes to the seller.</p>
        <label className="mt-5 block text-sm font-bold">Buyer share (%)
          <input autoFocus value={buyerPercent} onChange={(event) => setBuyerPercent(event.target.value)} type="number" min="0" max="100" step="any" className="mt-2 w-full rounded-lg border p-2 font-normal" />
        </label>
        <input type="range" min="0" max="100" step="1" value={percent} onChange={(event) => setBuyerPercent(event.target.value)} className="mt-3 w-full" />
        <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-800">{buyerAmount} {symbol} to buyer ({percent}%) · {sellerAmount} {symbol} to seller ({100 - percent}%)</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 p-3 font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => onApply(String(buyerAmount))} className="rounded-lg bg-amber-500 p-3 font-semibold text-white hover:bg-amber-600">Use this split</button>
        </div>
      </div>
    </div>
  );
}
