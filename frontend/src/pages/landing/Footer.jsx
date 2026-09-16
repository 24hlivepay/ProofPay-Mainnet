export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-slate-900 text-white">

      <div className="mx-auto max-w-7xl px-6 py-16">

        <div className="grid gap-12 md:grid-cols-3">

          <div>

            <h2 className="text-3xl font-bold">
              ProofPay
            </h2>

            <p className="mt-4 leading-8 text-slate-300">
              Secure P2P Crypto Escrow powered by smart contracts on
              ARC Blockchain.
            </p>

          </div>

          <div>

            <h3 className="text-xl font-semibold">
              Product
            </h3>

            <ul className="mt-5 space-y-3 text-slate-300">

              <li>Documentation</li>

              <li>Security</li>

              <li>Roadmap</li>

              <li>GitHub</li>

            </ul>

          </div>

          <div>

            <h3 className="text-xl font-semibold">
              Legal
            </h3>

            <ul className="mt-5 space-y-3 text-slate-300">

              <li>Privacy Policy</li>

              <li>Terms of Service</li>

              <li>Support</li>

              <li>Contact</li>

            </ul>

          </div>

        </div>

        <div className="mt-12 border-t border-slate-700 pt-8 text-center text-slate-400">

          © 2026 ProofPay. Powered by ARC Blockchain.

        </div>

      </div>

    </footer>
  );
}