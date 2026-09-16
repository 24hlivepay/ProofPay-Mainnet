import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";

import api from "../services/api";
import { useEscrow } from "../context/EscrowContext";

export default function WaitingSeller() {

  const navigate = useNavigate();

  const { escrowData, setEscrowData } = useEscrow();

  const [copied, setCopied] = useState(false);

  const sellerRejected =
    escrowData.status === "Cancelled" &&
    escrowData.cancellationReason === "Rejected by Seller";

  const secureLink =
    `${window.location.origin}/#/escrow/${escrowData.escrowId}`;

  /*
  |--------------------------------------------------------------------------
  | Copy Secure Link
  |--------------------------------------------------------------------------
  */

  async function copyLink() {

    try {

      await navigator.clipboard.writeText(secureLink);

      setCopied(true);

      setTimeout(() => {

        setCopied(false);

      }, 2000);

    } catch {

      alert("Unable to copy link.");

    }

  }

  /*
  |--------------------------------------------------------------------------
  | Share Secure Link
  |--------------------------------------------------------------------------
  */

  async function shareLink() {

    try {

      if (navigator.share) {

        await navigator.share({

          title: "ProofPay Escrow",

          text: "Open this secure escrow.",

          url: secureLink,

        });

      } else {

        await navigator.clipboard.writeText(secureLink);

        alert(
          "Sharing is not supported.\n\nSecure link copied to clipboard."
        );

      }

    } catch (error) {

      console.log(error);

    }

  }

  /*
  |--------------------------------------------------------------------------
  | Poll Seller Status
  |--------------------------------------------------------------------------
  */

  useEffect(() => {

    if (!escrowData.escrowId) return;

    const interval = setInterval(async () => {

      try {

        const response = await api.get(
          `/escrow/${escrowData.escrowId}/status`
        );

        console.log("Buyer Polling:", response.data);

        setEscrowData(response.data.escrow);

        if (response.data.escrow.status === "Seller Accepted") {

          clearInterval(interval);

          navigate("/deposit", { state: { backTo: "/pending-orders" } });

        }

        if (response.data.escrow.status === "Cancelled") {

          clearInterval(interval);

        }

      } catch (error) {

        console.log(error);

      }

    }, 2000);

    return () => clearInterval(interval);

  }, [escrowData.escrowId, navigate, setEscrowData]);

  return (

    <div className="min-h-screen bg-slate-100">

      <Navbar />

      <main className="mx-auto max-w-2xl px-5 py-7 sm:px-6">

        <button
          onClick={() => navigate("/dashboard/buying")}
          className="mb-5 text-sm font-semibold text-blue-600 hover:text-blue-700"
        >
          ← Back to Buying Escrows
        </button>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <div className="flex items-center justify-between">

            <div>

              <h1 className="text-2xl font-bold text-slate-900">
                {sellerRejected ? "Deal Rejected" : "Waiting for Seller"}
              </h1>

              <p className="mt-2 text-sm text-slate-600">
                {sellerRejected
                  ? "The seller has rejected this escrow request."
                  : "Your escrow request has been created successfully."}
              </p>

            </div>

            <div className={`rounded-full px-5 py-2 font-semibold ${
              sellerRejected
                ? "bg-red-100 text-red-700"
                : "bg-yellow-100 text-yellow-700"
            }`}>
              {sellerRejected ? "Cancelled" : "Waiting"}
            </div>

          </div>          {/* Secure Link */}

          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">

            <h2 className="text-lg font-bold text-blue-700">
              Secure Link
            </h2>

            <div className="mt-4 space-y-4">

              <div>

                <p className="text-slate-500">
                  Escrow ID
                </p>

                <h3 className="mt-1 text-xl font-bold">
                  {escrowData.escrowId}
                </h3>

              </div>

              <div>

                <p className="text-slate-500">
                  Secure Link
                </p>

                <div className="mt-3 rounded-xl border bg-white p-4">

                  <p className="break-all text-blue-600">

                    {secureLink}

                  </p>

                </div>

              </div>

            </div>

          </div>

          {/* Actions */}

          <div className="mt-4 grid grid-cols-2 gap-3">

            <button
              onClick={copyLink}
              className="rounded-xl border py-3 font-semibold transition hover:bg-slate-100"
            >

              {copied ? "✅ Link Copied" : "📋 Copy Link"}

            </button>

            <button
              onClick={shareLink}
              className="rounded-xl border py-3 font-semibold transition hover:bg-slate-100"
            >

              📤 Share Link

            </button>

          </div>

          {/* Escrow Summary */}

          <div className="mt-5 rounded-xl border border-slate-200 p-4 sm:p-5">

            <h2 className="mb-4 text-lg font-bold">
              Escrow Summary
            </h2>

            <div className="space-y-4">

              <div className="flex justify-between">
                <span className="text-slate-500">Buyer Name</span>
                <strong>{escrowData.buyerName}</strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Seller Name</span>
                <strong>{escrowData.sellerName}</strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Product / Service</span>
                <strong>{escrowData.productName}</strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <strong>{escrowData.amount} {escrowData.assetSymbol || "USDC"}</strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">Escrow ID</span>
                <strong>{escrowData.escrowId}</strong>
              </div>

            </div>

            </div>

          {/* Live Status */}

<div className={`mt-5 rounded-xl border p-4 text-center shadow-sm ${
  sellerRejected
    ? "border-red-200 bg-gradient-to-br from-red-50 to-white"
    : "border-blue-200 bg-gradient-to-br from-blue-50 to-white"
}`}>

  <div className="text-3xl">
    {sellerRejected ? "✖️" : "⏳"}
  </div>

  <h2 className={`mt-2 text-xl font-bold ${
    sellerRejected ? "text-red-700" : "text-blue-700"
  }`}>
    {sellerRejected ? "Deal Rejected by Seller" : "Waiting for Seller"}
  </h2>

  <p className="mt-3 text-sm font-medium text-slate-700">
    {sellerRejected
      ? "This escrow has been cancelled. No funds were deposited."
      : "Your secure ProofPay escrow has been created successfully."}
  </p>

  <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">
    {sellerRejected ? (
      "You can find this deal in Cancelled Purchases."
    ) : (
      <>
        The seller has not opened your secure link yet.
        <br />
        Once the seller connects the wallet and accepts the escrow,
        this page will automatically continue to the deposit page.
      </>
    )}
  </p>

</div>

{/* Auto Status */}

{!sellerRejected && <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-center text-sm">

  <p className="font-semibold text-green-700">
    ✅ ProofPay automatically checks the seller status every 2 seconds.
  </p>

</div>}

{/* Continue */}

<div className="mt-6">

  <PrimaryButton
    onClick={() => sellerRejected
      ? navigate("/cancelled-orders", { state: { role: "buyer" } })
      : navigate("/dashboard/buying")
    }
  >
    {sellerRejected ? "View Cancelled Purchases" : "Back to Buying Escrows"}
  </PrimaryButton>

</div>

</div>

</main>

</div>

);

}
