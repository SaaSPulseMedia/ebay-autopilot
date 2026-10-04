const steps = [
  {
    number: "01",
    title: "Create your account",
    body:
      "Email and password, three-day trial, no card at signup. Your password is hashed with bcrypt and your session is an HTTP-only signed cookie.",
  },
  {
    number: "02",
    title: "Connect a store, or stay in demo",
    body:
      "Press Connect eBay store, approve on eBay's own screen, and you are connected. No developer account, no keys, nothing to install. Not ready? Demo mode runs everything without touching eBay.",
  },
  {
    number: "03",
    title: "Select your products",
    body:
      "Tick one product or your whole batch in the research feed, or paste a list of supplier URLs. Your pricing rule is applied to the whole selection at once.",
  },
  {
    number: "04",
    title: "Press List selected",
    body:
      "AutoPilot writes the copy, expands the variants, attaches your policies, and publishes the batch in the background — then keeps every listing priced and in stock.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="border-b border-white/10 bg-navy-950 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">How it works</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            Four steps from signing up to a live batch
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            There is no long onboarding. The only step you repeat is step three, and that is the one that takes a few
            clicks instead of an afternoon.
          </p>
        </div>

        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step) => (
            <li key={step.number} className="ap-card relative rounded-2xl p-6">
              <span className="text-sm font-bold tracking-[0.2em] text-brand-400">{step.number}</span>
              <h3 className="mt-3 text-lg font-semibold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
