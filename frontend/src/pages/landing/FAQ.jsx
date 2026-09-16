export default function FAQ() {
  const faqs = [
    {
      question: "Is ProofPay non-custodial?",
      answer:
        "Yes. Funds remain locked inside smart contracts. ProofPay never takes custody of your assets.",
    },
    {
      question: "Which currency is supported?",
      answer:
        "ProofPay V1 uses USDC on ARC Blockchain for escrow payments.",
    },
    {
      question: "What happens if there is a dispute?",
      answer:
        "Buyers can open a dispute before funds are released. The escrow remains locked until the dispute process is completed.",
    },
    {
      question: "Does the seller need an account?",
      answer:
        "No. The seller only needs to open the secure escrow link and connect a supported wallet.",
    },
  ];

  return (
    <section className="bg-white py-24">

      <div className="mx-auto max-w-5xl px-6">

        <div className="text-center">

          <h2 className="text-4xl font-bold text-slate-900">
            Frequently Asked Questions
          </h2>

          <p className="mt-5 text-lg text-slate-600">
            Everything you need to know before using ProofPay.
          </p>

        </div>

        <div className="mt-16 space-y-6">

          {faqs.map((faq) => (

            <div
              key={faq.question}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-8"
            >

              <h3 className="text-xl font-bold text-slate-900">
                {faq.question}
              </h3>

              <p className="mt-4 leading-8 text-slate-600">
                {faq.answer}
              </p>

            </div>

          ))}

        </div>

      </div>

    </section>
  );
}