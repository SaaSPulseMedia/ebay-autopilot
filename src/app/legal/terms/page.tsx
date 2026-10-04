import Link from "next/link";

export const metadata = { title: "Terms of service" };

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="text-sm text-brand-400 hover:text-brand-500">
        ← Back to site
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">Terms of service</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-300">
        <p>
          eBay AutoPilot is software that helps you research, create, and maintain eBay listings. You are the seller of
          record for everything you publish. You are responsible for complying with eBay&apos;s policies, your
          supplier&apos;s terms, and applicable law in your jurisdiction.
        </p>
        <p>
          Subscriptions are billed monthly in USD. You can cancel at any time from the billing page; access continues
          until the end of the period you have already paid for and nothing renews after that. The three-day trial does
          not require a card.
        </p>
        <p>
          We make no guarantee of sales, revenue, or profit. Margin figures shown in the product are calculated from
          supplier data and published eBay fee rates and are estimates, not promises.
        </p>
        <p>
          eBay AutoPilot is not affiliated with, endorsed by, or sponsored by eBay Inc. Trademarks belong to their
          respective owners.
        </p>
      </div>
    </main>
  );
}
