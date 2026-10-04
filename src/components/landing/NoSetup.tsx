import Link from "next/link";

const points = [
  {
    icon: "🚫",
    title: "No developer account",
    body: "We hold the eBay developer application. You are never asked to apply for one, and you will never see an API key.",
  },
  {
    icon: "👆",
    title: "Connecting is one click",
    body: "Press Connect eBay store, approve on eBay's own screen, and you are done. Most people finish setup in under five minutes.",
  },
  {
    icon: "💬",
    title: "We set it up with you",
    body: "If you get stuck, email us and we will walk you through it. We would rather help you properly than lose you at step two.",
  },
];

export function NoSetup() {
  return (
    <section className="border-b border-white/10 bg-navy-950 py-16 lg:py-20">
      <div className="mx-auto max-w-6xl px-5">
        <div className="ap-card rounded-2xl p-7 lg:p-9">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">No technical setup</p>
              <h2 className="mt-3 text-[clamp(1.7rem,3.2vw,2.4rem)] font-bold leading-tight tracking-tight text-white">
                If you can sign in to eBay, you can use this
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-300">
                Most eBay sellers are not software people, and you should not have to be. There is nothing to install
                and nothing to configure.
              </p>
              <Link
                href="/guide"
                className="mt-5 inline-block rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/5"
              >
                Read the plain-English setup guide →
              </Link>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {points.map((point) => (
                <div key={point.title} className="rounded-xl bg-white/5 p-4">
                  <span aria-hidden className="text-xl">
                    {point.icon}
                  </span>
                  <h3 className="mt-2 text-sm font-semibold text-white">{point.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-slate-400">{point.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
