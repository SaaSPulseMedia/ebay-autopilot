import Link from "next/link";

const manualSteps = [
  "Open the supplier page, copy the title, trim it to 80 characters",
  "Re-type 20+ item specifics eBay wants for the category",
  "Save every photo, re-upload it, re-order the gallery",
  "Build each variant row — size, color, SKU, price, quantity",
  "Write a description that is not a copy-paste of the supplier's",
  "Set shipping, returns, and payment policies again",
  "Repeat from the top for the next product",
];

const autopilotSteps = [
  "Tick the products you want (or paste a list of supplier URLs)",
  "AI writes the title, specifics, description, and bullets",
  "Variants are generated from the supplier options automatically",
  "Images are pulled through and ordered for you",
  "Your pricing rule sets the price with eBay fees already deducted",
  "Your saved business policies are applied to every listing",
  "Press one button — the whole batch goes out",
];

export function BulkListing() {
  return (
    <section id="bulk" className="ap-grid-bg border-b border-white/10 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-3xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-lime-brand/30 bg-lime-brand/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-lime-brand">
            The core of the product
          </span>
          <h2 className="mt-5 text-[clamp(2rem,4.4vw,3.2rem)] font-extrabold leading-[1.06] tracking-tight text-white">
            One button. Your whole batch
            <br />
            <span className="text-brand-400">listed on eBay.</span>
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-slate-300">
            Listing is the job every store owner quietly hates. A single product with variants means re-typing the
            title, filling 20+ item specifics, re-uploading photos, and building every size and color row by hand — and
            then doing it all again for the next one. It is the task sellers most often hand off to a hired lister.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-300">
            AutoPilot does that work for you. Select products individually or tick a whole batch, press{" "}
            <span className="font-semibold text-white">List selected</span>, and the batch is written, priced, and
            published while you do something else.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <article className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Listing it by hand</h3>
              <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-semibold text-red-300">
                Per product
              </span>
            </div>
            <ul className="mt-4 space-y-2.5">
              {manualSteps.map((step) => (
                <li key={step} className="flex items-start gap-2.5 text-sm text-slate-400">
                  <span aria-hidden className="mt-0.5 text-red-400/80">
                    ✕
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </article>

          <article className="ap-card ap-glow rounded-2xl border-brand-500/40 p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-white">Listing it with AutoPilot</h3>
              <span className="rounded-full bg-lime-brand/15 px-3 py-1 text-xs font-semibold text-lime-brand">
                Per batch
              </span>
            </div>
            <ul className="mt-4 space-y-2.5">
              {autopilotSteps.map((step) => (
                <li key={step} className="flex items-start gap-2.5 text-sm text-slate-200">
                  <span aria-hidden className="mt-0.5 text-lime-brand">
                    ✓
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </article>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Bulk or individual",
              body:
                "Tick one product or a full batch of up to 200. The same engine handles both — there is no separate workflow to learn, and batch size scales with your plan.",
            },
            {
              title: "Variants built for you",
              body:
                "Size, color, and style combinations are expanded into a proper multi-variant listing with its own SKU, price, and quantity per row.",
            },
            {
              title: "Roughly 30 seconds each",
              body:
                "A product goes from selected to published in about thirty seconds, and the batch runs in the background — you do not sit and watch it.",
            },
          ].map((item) => (
            <article key={item.title} className="ap-card rounded-2xl p-6">
              <h3 className="text-base font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/signup"
            className="ap-glow rounded-full bg-brand-500 px-7 py-3.5 text-center text-base font-semibold text-white transition hover:bg-brand-400"
          >
            Try bulk listing free for 3 days
          </Link>
          <Link
            href="/#pricing"
            className="rounded-full border border-white/20 px-7 py-3.5 text-center text-base font-semibold text-slate-100 transition hover:border-white/40 hover:bg-white/5"
          >
            See bulk limits by plan
          </Link>
        </div>
      </div>
    </section>
  );
}
