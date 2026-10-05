import type { CatalogStats } from "@/lib/suppliers";

export function BuiltFor({ stats }: { stats: CatalogStats }) {
  const proofs = [
    {
      label: "Bulk listing with variants, in one click",
      detail:
        "Select up to 50 products and publish the batch in a single run, with size and color variants expanded into proper multi-variant listings.",
    },
    {
      label: "Profit math on every product",
      detail:
        "The catalog in this deployment currently holds " +
        `${stats.productCount} products across ${stats.categoryCount} categories, each priced after eBay's fees` +
        (stats.sample ? " (starter products with example supplier prices)." : "."),
    },
    {
      label: "Brand-name (VeRO) screening",
      detail:
        "Every product is checked for brand names that get eBay listings removed. Risky items are blocked before they publish, one by one or in bulk.",
    },
  ];

  return (
    <section id="built-for" className="border-b border-white/10 bg-navy-900 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">Why AutoPilot</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            Built for serious eBay sellers
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            We are a new product and we are not going to pretend otherwise. Instead of reviews we cannot verify, here is
            exactly what the software does today — you can check every claim inside the dashboard on your trial.
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {proofs.map((proof) => (
            <article key={proof.label} className="ap-card rounded-2xl p-6">
              <span className="inline-flex items-center gap-2 rounded-full border border-lime-brand/30 bg-lime-brand/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-lime-brand">
                Shipping today
              </span>
              <h3 className="mt-4 text-lg font-semibold leading-snug text-white">{proof.label}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{proof.detail}</p>
            </article>
          ))}
        </div>

        <div className="ap-card mt-6 grid gap-8 rounded-2xl p-7 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h3 className="text-lg font-semibold text-white">Why we built it</h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              Ask any eBay store owner what they hate most and the answer is listing. One product with variants means
              retyping the title into an 80-character box, filling in 20+ item specifics, re-uploading photos, and
              building every size and color row by hand. It is the single most commonly outsourced task in this
              business — there is an entire freelance market that exists only because sellers will pay someone else to
              do it.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              We built AutoPilot so you can press one button instead. The batch is written, priced after real eBay
              fees, variant-expanded, brand-screened, and published. Automatic stock and price syncing is in progress. Everything you see
              on your dashboard is produced by your own account&apos;s data — we do not ship placeholder numbers, and we
              do not publish testimonials we cannot stand behind.
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 self-start">
            <div className="rounded-xl bg-white/5 p-4">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">Catalog size</dt>
              <dd className="mt-1 text-2xl font-bold text-white">{stats.productCount}</dd>
            </div>
            <div className="rounded-xl bg-white/5 p-4">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">Median net margin</dt>
              <dd className="mt-1 text-2xl font-bold text-white">{stats.medianMarginPct.toFixed(1)}%</dd>
            </div>
            <div className="rounded-xl bg-white/5 p-4">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">Avg. profit / unit</dt>
              <dd className="mt-1 text-2xl font-bold text-white">${stats.averageNetProfit.toFixed(2)}</dd>
            </div>
            <div className="rounded-xl bg-white/5 p-4">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">Clicks to list a batch</dt>
              <dd className="mt-1 text-2xl font-bold text-white">1</dd>
            </div>
            <p className="col-span-2 text-[11px] leading-relaxed text-slate-500">
              Figures are calculated at request time from the catalog running in this deployment, net of eBay&apos;s
              final value and per-order fees.
              {stats.sample ? " The catalog currently uses starter products with example supplier prices." : ""}
            </p>
          </dl>
        </div>
      </div>
    </section>
  );
}
