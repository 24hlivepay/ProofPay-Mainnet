export default function HowItWorks() {
  const steps = [
    {
      number: "01",
      title: "Connect Wallet",
      description:
        "Buyer securely connects a supported crypto wallet to ProofPay.",
    },
    {
      number: "02",
      title: "Create Escrow",
      description:
        "Buyer enters the amount and deal details, then generates a secure escrow link.",
    },
    {
      number: "03",
      title: "Seller Accepts",
      description:
        "Seller opens the secure link, reviews the deal, connects a wallet and accepts.",
    },
    {
      number: "04",
      title: "Buyer Deposits",
      description:
        "After seller verification, buyer deposits USDC into the escrow smart contract.",
    },
    {
      number: "05",
      title: "Complete Transaction",
      description:
        "Buyer releases funds after receiving the product or service. Refund and dispute remain available if required.",
    },
  ];

  return (
    <section className="bg-slate-50 py-24">

      <div className="mx-auto max-w-7xl px-6">

        <div className="text-center">

          <h2 className="text-4xl font-bold text-slate-900">
            How ProofPay Works
          </h2>

          <p className="mt-5 text-lg text-slate-600">
            Five simple steps to complete a secure crypto escrow transaction.
          </p>

        </div>

        <div className="mt-20 space-y-8">

          {steps.map((step) => (

            <div
              key={step.number}
              className="flex gap-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm"
            >

              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-2xl font-bold text-white">

                {step.number}

              </div>

              <div>

                <h3 className="text-2xl font-bold text-slate-900">
                  {step.title}
                </h3>

                <p className="mt-3 leading-8 text-slate-600">
                  {step.description}
                </p>

              </div>

            </div>

          ))}

        </div>

      </div>

    </section>
  );
}