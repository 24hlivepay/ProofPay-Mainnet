import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function OrderHistory() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">

      <div className="flex justify-between items-center">

        <h1 className="text-3xl font-bold">
          Order History
        </h1>

        <button
          onClick={() => navigate("/dashboard")}
          className="text-blue-600 font-semibold"
        >
          Home
        </button>

      </div>

      <div className="mt-7 space-y-3">

        <div className="border rounded-xl p-5 flex justify-between">

          <div>

            <h2 className="font-bold">
              Order #1001
            </h2>

            <p className="text-slate-500">
              100 USDC
            </p>

          </div>

          <span className="text-green-600 font-bold">
            Completed
          </span>

        </div>

        <div className="border rounded-xl p-5 flex justify-between">

          <div>

            <h2 className="font-bold">
              Order #1002
            </h2>

            <p className="text-slate-500">
              250 USDC
            </p>

          </div>

          <span className="text-yellow-600 font-bold">
            Pending
          </span>

        </div>

      </div>

      </div>
      </main>
    </div>
  )
}
