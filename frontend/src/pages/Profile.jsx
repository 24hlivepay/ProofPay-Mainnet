import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import InputField from "../components/InputField";
import { useWalletBadge } from "../hooks/useWalletBadge";
import { getProfileName, setProfileName } from "../utils/profile";

export default function Profile() {
  const { walletSlot, walletAddress } = useWalletBadge();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(getProfileName(walletAddress));
  }, [walletAddress]);

  function handleSave() {
    setProfileName(walletAddress, name);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar walletSlot={walletSlot} />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">

      <div className="mx-auto h-16 w-16 rounded-full bg-blue-600"></div>

      <h1 className="mt-4 text-3xl font-bold">
        Your Profile
      </h1>

      <p className="mt-4 text-slate-500">
        Connected Wallet
      </p>

      <div className="mt-4 break-all rounded-xl border p-4 font-mono text-sm">
        {walletAddress || "Not connected"}
      </div>

      <div className="mt-8 text-left">
        <label className="mb-2 block text-sm font-semibold text-slate-700">
          Your Name
        </label>
        <InputField
          placeholder="Enter your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={!walletAddress}
        />
        <p className="mt-2 text-sm text-slate-500">
          This name fills in automatically as Buyer Name when you create an escrow, and as Seller Name when you accept one.
        </p>
        <button
          onClick={handleSave}
          disabled={!walletAddress || !name.trim()}
          className="mt-4 w-full rounded-xl bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saved ? "Saved ✓" : "Save Name"}
        </button>
      </div>

      <button
        onClick={() => navigate("/dashboard")}
        className="mt-7 rounded-xl bg-slate-100 px-6 py-3 font-semibold text-slate-700 hover:bg-slate-200"
      >
        Back Home
      </button>

      </div>
      </main>
    </div>
  )
}
