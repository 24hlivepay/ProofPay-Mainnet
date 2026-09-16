import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function Profile() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">

      <div className="mx-auto h-16 w-16 rounded-full bg-blue-600"></div>

      <h1 className="mt-4 text-3xl font-bold">
        Wallet Profile
      </h1>

      <p className="mt-4 text-slate-500">
        Connected Wallet
      </p>

      <div className="mt-4 border rounded-xl p-4">

        0x91AF...3B12

      </div>

      <div className="grid grid-cols-2 gap-4 mt-8">

        <div className="rounded-xl border p-4">

          <h2 className="text-2xl font-bold">
            12
          </h2>

          <p>
            Orders
          </p>

        </div>

        <div className="rounded-xl border p-4">

          <h2 className="text-2xl font-bold">
            100%
          </h2>

          <p>
            Success
          </p>

        </div>

      </div>

      <button
        onClick={() => navigate("/dashboard")}
        className="mt-7 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
      >
        Back Home
      </button>

      </div>
      </main>
    </div>
  )
}
