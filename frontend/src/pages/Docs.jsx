import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import CopyButton from "../components/CopyButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { NETWORKS } from "../config/network";
import { getEscrowAssets } from "../config/escrowAssets";
import { DOC_SECTIONS, DOCS_UPDATED } from "../docs/content";

// Public documentation: readable without a wallet, one topic per URL
// (/docs/<topic>) so a topic can be linked to. The text lives in
// docs/content.js; this file only lays it out.
export default function Docs() {
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const { sectionId } = useParams();
  const index = Math.max(0, DOC_SECTIONS.findIndex((section) => section.id === sectionId));
  const section = DOC_SECTIONS[index];
  const previous = DOC_SECTIONS[index - 1];
  const next = DOC_SECTIONS[index + 1];

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [section.id]);

  const open = (id) => navigate(`/docs/${id}`);

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-6">
        <h1 className="text-3xl font-bold text-slate-900">ProofPay Docs</h1>
        <p className="mt-2 text-slate-600">How ProofPay works, in plain words. Last updated {DOCS_UPDATED}.</p>

        <label className="mt-6 block lg:hidden">
          <span className="text-sm font-semibold text-slate-600">Topic</span>
          <select
            value={section.id}
            onChange={(event) => open(event.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold text-slate-900 outline-none focus:border-blue-500"
          >
            {DOC_SECTIONS.map((item) => (
              <option key={item.id} value={item.id}>{item.title}</option>
            ))}
          </select>
        </label>

        <div className="mt-6 flex items-start gap-6">
          <nav aria-label="Docs topics" className="sticky top-6 hidden w-60 shrink-0 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:block">
            {DOC_SECTIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => open(item.id)}
                aria-current={item.id === section.id ? "page" : undefined}
                className={`block w-full rounded-xl px-3.5 py-2.5 text-left text-sm font-semibold transition ${
                  item.id === section.id ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {item.title}
              </button>
            ))}
          </nav>

          <article className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-2xl font-bold text-slate-900">{section.title}</h2>
            <p className="mt-1 text-slate-500">{section.summary}</p>

            <div className="mt-6 space-y-4">
              {section.blocks.map((block, blockIndex) => (
                <Block key={blockIndex} block={block} />
              ))}
            </div>

            <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-slate-200 pt-6">
              {previous ? (
                <button type="button" onClick={() => open(previous.id)} className="font-semibold text-blue-600 hover:text-blue-700">
                  ← {previous.title}
                </button>
              ) : <span />}
              {next && (
                <button type="button" onClick={() => open(next.id)} className="font-semibold text-blue-600 hover:text-blue-700">
                  {next.title} →
                </button>
              )}
            </div>
          </article>
        </div>
      </main>
    </div>
  );
}

function Block({ block }) {
  if (block.h) return <h3 className="pt-3 text-lg font-bold text-slate-900">{block.h}</h3>;
  if (block.p) return <p className="leading-7 text-slate-700">{block.p}</p>;
  if (block.steps) {
    return (
      <ol className="space-y-3">
        {block.steps.map((step, stepIndex) => (
          <li key={stepIndex} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
              {stepIndex + 1}
            </span>
            <span className="leading-7 text-slate-700">{step}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.list) {
    return (
      <ul className="list-disc space-y-2 pl-5 leading-7 text-slate-700 marker:text-slate-400">
        {block.list.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
      </ul>
    );
  }
  if (block.note) {
    return (
      <p className={`rounded-xl p-4 leading-7 ${block.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
        {block.note}
      </p>
    );
  }
  if (block.table) {
    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {block.table.head.map((cell, cellIndex) => <th key={cellIndex} className="px-4 py-3 font-semibold">{cell}</th>)}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-slate-200 align-top">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={`px-4 py-3 leading-6 ${cellIndex === 0 ? "font-semibold text-slate-900" : "text-slate-700"}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.contracts) return <ContractAddresses />;
  return null;
}

// The escrow contracts the app really uses, straight from the same config
// the deposit and release code reads.
function ContractAddresses() {
  return (
    <div className="space-y-4">
      {Object.values(NETWORKS).map((network) => (
        <div key={network.id} className="rounded-xl border border-slate-200 p-4">
          <p className="font-semibold text-slate-900">{network.chainName}</p>
          <div className="mt-2 space-y-2">
            {getEscrowAssets(network.id).map((asset) => (
              <div key={asset.symbol} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="w-24 shrink-0 text-slate-500">{asset.symbol} escrow</span>
                <a
                  href={`${network.explorerBase}/address/${asset.escrowAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all font-mono text-blue-600 hover:text-blue-700"
                >
                  {asset.escrowAddress}
                </a>
                <CopyButton value={asset.escrowAddress} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
