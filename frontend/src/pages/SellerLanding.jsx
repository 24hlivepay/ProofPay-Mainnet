import { useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import PrimaryButton from "../components/PrimaryButton";

import { useEscrow } from "../context/EscrowContext";

export default function SellerLanding() {

  const navigate = useNavigate();

  const { escrowData } = useEscrow();

  return (

    <div className="min-h-screen bg-slate-100">

      <Navbar />

      <main className="mx-auto max-w-3xl px-5 py-8 sm:px-6">

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">

          <div className="flex items-center justify-between">

            <div>

              <h1 className="text-3xl font-bold text-slate-900">
                Secure Escrow Invitation
              </h1>

              <p className="mt-3 text-slate-600">
                A buyer has invited you to complete this escrow transaction.
              </p>

            </div>

            <div className="rounded-full bg-blue-100 px-5 py-2 font-semibold text-blue-700">
              Seller View
            </div>

          </div>

          {/* Escrow Summary */}

          <div className="mt-7 rounded-xl border border-slate-200 p-5 sm:p-6">

            <h2 className="mb-6 text-2xl font-bold">
              Escrow Summary
            </h2>

            <div className="space-y-5">

              <div className="flex justify-between">
                <span className="text-slate-500">
                  Buyer Name
                </span>

                <strong>
                  {escrowData.buyerName}
                </strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">
                  Seller Name
                </span>

                <strong>
                  {escrowData.sellerName}
                </strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">
                  Product / Service
                </span>

                <strong>
                  {escrowData.productName}
                </strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">
                  Amount
                </span>

                <strong>
                  {escrowData.amount} {escrowData.assetSymbol || "USDC"}
                </strong>
              </div>

              <div className="flex justify-between">
                <span className="text-slate-500">
                  Escrow ID
                </span>

                <strong>
                  {escrowData.escrowId}
                </strong>
              </div>

            </div>

          </div>

          {/* Notice */}

          <div className="mt-8 rounded-2xl border border-yellow-200 bg-yellow-50 p-6">

            <h3 className="text-lg font-bold text-yellow-700">
              Before You Continue
            </h3>

            <p className="mt-3 text-slate-700 leading-7">
              Please connect the wallet that will receive this payment.
              Your wallet address will automatically be linked to this
              escrow. After connecting your wallet, you'll be able to
              review the deal and decide whether to accept or reject it.
            </p>

          </div>

          {/* Connect Wallet */}

          <div className="mt-10">

            <PrimaryButton
              onClick={() => navigate("/dashboard/selling")}
            >
              Connect Wallet
            </PrimaryButton>

          </div>

        </div>

      </main>

    </div>

  );
}
