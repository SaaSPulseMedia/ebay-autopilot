import Link from "next/link";

import type { CatalogStats } from "@/lib/suppliers";

const chips = [
  "List your whole batch in one click",
  "Variants built automatically",
  "3-day free trial · no card required",
];

export function Hero({ stats }: { stats: CatalogStats }) {
  return (
    <section className="ap-grid-bg relative overflow-hidden border-b border-white/10">
      <div className="mx-auto grid max-w-6xl gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-lime-brand/30 bg-lime-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-lime-brand">
            Automated bulk listing
          </span>

          <h1 className="mt-5 text-[clamp(2.4rem,5.4vw,4rem)] font-extrabold leading-[1.04] tracking-tight text-white">
            Run your eBay store
            <br />
            on <span className="text-brand-400">autopilot</span>
          </h1>

          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
            Stop typing listings one at a time. Select your products, press one button, and eBay AutoPilot writes the
            copy, builds every variant, applies your pricing, and publishes the whole batch — individually or in bulk.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="ap-glow rounded-full bg-brand-500 px-7 py-3.5 text-center text-base font-semibold text-white transition hover:bg-brand-400"
            >
              Start your 3-day free trial
            </Link>
            <Link
              href="/#bulk"
              className="rounded-full border border-white/20 px-7 py-3.5 text-center text-base font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/5"
            >
              See bulk listing
            </Link>
          </div>

          <ul className="mt-8 flex flex-wrap gap-2.5">
            {chips.map((chip) => (
              <li
                key={chip}
                className="flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-[13px] text-slate-200"
              >
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-lime-brand" />
                {chip}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">
          <div className="ap-card ap-glow rounded-2xl p-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <p className="text-sm font-semibold text-white">Bulk listing run</p>
              <span className="rounded-full bg-lime-brand/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-lime-brand">
                Live
              </span>
            </div>

            <ul className="mt-4 space-y-2">
              {[
                { name: "Adjustable Laptop Stand Riser", state: "Published", variants: "3 variants" },
                { name: "Cordless Spin Scrubber Kit", state: "Published", variants: "5 variants" },
                { name: "Magnetic Car Phone Mount", state: "Publishing…", variants: "2 variants" },
                { name: "Memory Foam Lumbar Cushion", state: "Queued", variants: "4 variants" },
              ].map((row) => (
                <li
                  key={row.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-navy-900/60 px-3 py-2.5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-white">{row.name}</span>
                    <span className="block text-[11px] text-slate-500">{row.variants}</span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                      row.state === "Published"
                        ? "bg-lime-brand/15 text-lime-brand"
                        : row.state === "Queued"
                          ? "bg-white/8 text-slate-400"
                          : "bg-brand-500/20 text-brand-400"
                    }`}
                  >
                    {row.state}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              disabled
              className="mt-4 w-full rounded-full bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white opacity-90"
            >
              List selected (4)
            </button>
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Illustration of the bulk runner. Live counts appear on your dashboard.
            </p>

            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-center">
              <div className="rounded-xl bg-white/5 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">Products ready</dt>
                <dd className="mt-1 text-xl font-bold text-white">{stats.productCount}</dd>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">Median margin</dt>
                <dd className="mt-1 text-xl font-bold text-white">{stats.medianMarginPct.toFixed(1)}%</dd>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <dt className="text-[11px] uppercase tracking-wide text-slate-400">Categories</dt>
                <dd className="mt-1 text-xl font-bold text-white">{stats.categoryCount}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11px] text-slate-500">
              Computed live from the supplier catalog in this deployment, after eBay fees.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
