import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import AdminNav from "../components/AdminNav";
import CopyButton from "../components/CopyButton";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { useAdminGate } from "../hooks/useAdminGate";
import { getEscrowAssets } from "../config/escrowAssets";
import { getExplorerAddressUrl, getExplorerTxUrl, getNetworkConfig } from "../config/network";
import { readEscrowContractState, setEscrowPausedOnChain } from "../services/proofpayContract";
import { shortenAddress } from "../utils/address";

// Admin control over the escrow contracts of the current network: pause or
// resume NEW escrows. Pausing never touches escrows that already exist, so it
// cannot trap money that is already locked.
export default function AdminContracts() {
  useAdminGate();
  const { walletSlot } = useWalletBadge();
  const navigate = useNavigate();
  const network = getNetworkConfig();
  const assets = getEscrowAssets();

  const [states, setStates] = useState({});
  const [busySymbol, setBusySymbol] = useState("");
  const [notice, setNotice] = useState(null);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled(
      getEscrowAssets().map((asset) => readEscrowContractState(asset.symbol))
    );
    const next = {};
    getEscrowAssets().forEach((asset, index) => {
      const result = results[index];
      next[asset.symbol] =
        result.status === "fulfilled"
          ? { data: result.value }
          : { error: "Could not read this contract from the network. Try again in a moment." };
    });
    setStates(next);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggle(asset, shouldPause) {
    const question = shouldPause
      ? `Pause new ${asset.symbol} escrows on ${network.chainName}?\n\nNobody will be able to start a new ${asset.symbol} escrow. Escrows that already exist keep working: delivery, release, disputes and your decisions are not affected.`
      : `Resume new ${asset.symbol} escrows on ${network.chainName}?\n\nPeople will be able to start new ${asset.symbol} escrows again.`;
    if (!window.confirm(question)) return;

    setBusySymbol(asset.symbol);
    setNotice(null);
    try {
      const hash = await setEscrowPausedOnChain(asset.symbol, shouldPause);
      setNotice({
        type: "success",
        text: shouldPause
          ? `${asset.symbol} contract paused: no new escrows.`
          : `${asset.symbol} contract resumed: new escrows are allowed again.`,
        hash,
      });
    } catch (error) {
      setNotice({ type: "error", text: error.message });
    } finally {
      setBusySymbol("");
      refresh();
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <button onClick={() => navigate("/dashboard")} className="text-sm font-semibold text-blue-700">
          ← Back to Dashboard
        </button>
        <h1 className="mt-4 text-3xl font-bold text-slate-900">Escrow contracts</h1>
        <p className="mt-2 text-slate-600">
          The escrow contracts on {network.chainName}. Pausing stops <strong>new</strong> escrows
          only. Money already locked is never affected, and delivery, release and disputes keep
          working. Pausing and resuming are sent from the admin wallet (MetaMask or Rabby) and
          only work for the contract owner.
        </p>

        <AdminNav />

        {notice && (
          <div
            className={`mb-4 rounded-xl border p-4 text-sm ${
              notice.type === "success"
                ? "border-green-200 bg-green-50 text-green-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
          >
            <p>{notice.text}</p>
            {notice.hash && (
              <a
                href={getExplorerTxUrl(notice.hash)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-semibold underline"
              >
                View transaction
              </a>
            )}
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {assets.map((asset) => {
            const state = states[asset.symbol];
            const data = state?.data;
            const busy = busySymbol === asset.symbol;

            return (
              <section key={asset.symbol} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold text-slate-900">{asset.symbol} escrow</h2>
                  {data && (
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        data.paused ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"
                      }`}
                    >
                      {data.paused ? "Paused: no new escrows" : "Accepting new escrows"}
                    </span>
                  )}
                </div>

                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Contract</dt>
                    <dd className="flex items-center gap-1 font-mono text-slate-900">
                      <a
                        href={getExplorerAddressUrl(asset.escrowAddress)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-700 underline"
                      >
                        {shortenAddress(asset.escrowAddress)}
                      </a>
                      <CopyButton value={asset.escrowAddress} />
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-slate-500">Owner (admin)</dt>
                    <dd className="flex items-center gap-1 font-mono text-slate-900">
                      {data ? shortenAddress(data.owner) : "…"}
                      {data && <CopyButton value={data.owner} />}
                    </dd>
                  </div>
                </dl>

                {state?.error && <p className="mt-3 text-sm text-red-700">{state.error}</p>}

                {data && (
                  <button
                    type="button"
                    disabled={busy || Boolean(busySymbol)}
                    onClick={() => handleToggle(asset, !data.paused)}
                    className={`mt-4 w-full rounded-lg p-3 font-semibold text-white disabled:opacity-50 ${
                      data.paused ? "bg-green-600" : "bg-red-600"
                    }`}
                  >
                    {busy
                      ? "Waiting for your wallet…"
                      : data.paused
                        ? "Resume new escrows"
                        : "Pause new escrows"}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </main>
    </div>
  );
}
