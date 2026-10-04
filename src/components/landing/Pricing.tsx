import Link from "next/link";

import { PLANS } from "@/lib/plans";

export function Pricing() {
  return (
    <section id="pricing" className="border-b border-white/10 bg-navy-950 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">Pricing</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            Launch pricing, billed monthly
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            Plans are separated by how much you can bulk-list. Starter is for proving it works on one store; Pro is the
            plan for sellers who list every day. Three days free, no card required to start, cancel any time.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <article
              key={plan.id}
              className={`ap-card relative flex flex-col rounded-2xl p-7 ${
                plan.highlight ? "border-brand-500/60 ap-glow" : ""
              }`}
            >
              {plan.highlight ? (
                <span className="absolute -top-3 left-7 rounded-full bg-lime-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-navy-950">
                  Unlimited bulk runs
                </span>
              ) : null}

              <h3 className="text-lg font-semibold text-white">{plan.name}</h3>
              <p className="mt-1 text-sm text-slate-400">{plan.tagline}</p>

              <p className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-tight text-white">${plan.price}</span>
                <span className="pb-1 text-sm text-slate-400">{plan.cadence}</span>
              </p>

              <p className="mt-4 rounded-xl border border-lime-brand/25 bg-lime-brand/[0.07] px-3 py-2 text-[13px] font-semibold text-lime-brand">
                ⚡ {plan.bulkLimit}
              </p>

              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span aria-hidden className="mt-1 text-lime-brand">
                      ✓
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={`/signup?plan=${plan.id}`}
                className={`mt-7 rounded-full px-5 py-3 text-center text-sm font-semibold transition ${
                  plan.highlight
                    ? "bg-brand-500 text-white hover:bg-brand-400"
                    : "border border-white/20 text-slate-100 hover:border-white/40 hover:bg-white/5"
                }`}
              >
                Start free trial
              </Link>
            </article>
          ))}
        </div>

        <p className="mt-6 text-sm text-slate-500">
          Prices are in USD and exclude any applicable sales tax. eBay&apos;s own selling fees are separate and are
          already subtracted in every margin figure AutoPilot shows you.
        </p>
      </div>
    </section>
  );
}
