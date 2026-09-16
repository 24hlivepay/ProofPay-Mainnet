export default function Features() {
  const features = [
    {
      icon: "🛡️",
      title: "Non-Custodial Security",
      description:
        "Funds stay locked inside ProofPay smart contracts until the transaction is completed.",
    },
    {
      icon: "⚡",
      title: "Fast Settlement",
      description:
        "Built on ARC Blockchain for secure, transparent and fast crypto escrow transactions.",
    },
    {
      icon: "🤝",
      title: "Buyer & Seller Verification",
      description:
        "Both parties verify every deal before any payment is deposited into escrow.",
    },
  ];

  return (
    <section className="bg-white py-24">

      <div className="mx-auto max-w-7xl px-6">

        <div className="text-center">

          <h2 className="text-4xl font-bold text-slate-900">
            Why Choose ProofPay?
          </h2>

          <p className="mt-5 text-lg text-slate-600">
            A decentralized escrow platform designed for secure peer-to-peer
            crypto trading.
          </p>

        </div>

        <div className="mt-16 grid gap-8 md:grid-cols-3">

          {features.map((item) => (

            <div
              key={item.title}
              className="rounded-3xl border border-slate-200 bg-slate-50 p-8 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:shadow-xl"
            >

              <div className="text-5xl">
                {item.icon}
              </div>

              <h3 className="mt-6 text-2xl font-bold text-slate-900">
                {item.title}
              </h3>

              <p className="mt-4 leading-8 text-slate-600">
                {item.description}
              </p>

            </div>

          ))}

        </div>

      </div>

    </section>
  );
}