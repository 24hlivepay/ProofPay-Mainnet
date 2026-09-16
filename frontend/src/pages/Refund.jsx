import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";

export default function Refund() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-100">
      <Navbar />
      <main className="mx-auto max-w-lg px-5 py-8 sm:px-6">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">

      <div className="mb-4 text-4xl">
        ↩️
      </div>

      <h1 className="text-3xl font-bold">
        Refund Requested
      </h1>

      <p className="mt-4 text-slate-500">
        Refund request has been submitted.
      </p>

      <button
        onClick={() => navigate("/dashboard/buying")}
        className="mt-7 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white"
      >
        Home
      </button>

      </div>
      </main>
    </div>
  )
}
