import Link from "next/link";

const chips = [
  "List your whole batch in one click",
  "Variants built automatically",
  "3-day free trial · no card required",
];

export function CTA() {
  return (
    <section className="ap-grid-bg border-b border-white/10 py-20 lg:py-24">
      <div className="mx-auto max-w-4xl px-5 text-center">
        <h2 className="text-[clamp(1.9rem,4vw,2.9rem)] font-extrabold leading-tight tracking-tight text-white">
          Stop listing one product at a time
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-300">
          Select your products, press one button, and let AutoPilot write, build the variants, price, and publish the
          whole batch. Start in demo mode in under a minute and connect your store when you are ready.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="ap-glow rounded-full bg-brand-500 px-8 py-3.5 text-base font-semibold text-white transition hover:bg-brand-400"
          >
            Start your 3-day free trial
          </Link>
          <Link
            href="/#pricing"
            className="rounded-full border border-white/20 px-8 py-3.5 text-base font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/5"
          >
            Compare plans
          </Link>
        </div>

        <ul className="mt-8 flex flex-wrap justify-center gap-2.5">
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
    </section>
  );
}
