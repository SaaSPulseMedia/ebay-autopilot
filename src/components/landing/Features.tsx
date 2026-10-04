const features = [
  {
    icon: "⚡",
    title: "One-click bulk listing",
    body:
      "The feature everything else exists to support. Select your products and publish them in a single run — the same engine handles one listing and a full batch, up to 200 per run.",
    flagship: true,
  },
  {
    icon: "🧬",
    title: "Automatic variant building",
    body:
      "Size, color, and style options are expanded into a proper multi-variant listing, each row with its own SKU, price, and quantity. This is the part that eats half an hour by hand.",
    flagship: true,
  },
  {
    icon: "✍️",
    title: "AI writes the listing",
    body:
      "Claude drafts an 80-character eBay title, benefit bullets, a description, and item specifics. If no AI key is configured, a deterministic template takes over so you are never blocked.",
    flagship: true,
  },
  {
    icon: "🔗",
    title: "Import from supplier URLs",
    body:
      "Paste one link or a whole list. AutoPilot fetches each page server-side and pulls the title, price, and images out of the markup so you are not copy-pasting fields.",
  },
  {
    icon: "🔎",
    title: "Research that shows the math",
    body:
      "Every row carries supplier cost, suggested price, shipping, and the net profit left after eBay's 13.55% final value fee and $0.40 per-order fee. No vanity scores.",
  },
  {
    icon: "🚀",
    title: "Three publishing engines",
    body:
      "Listings post straight to your eBay shop through our official partner connection. A backup method is in the works, and demo mode lets you try everything without posting anything.",
  },
  {
    icon: "📉",
    title: "Repricing and stock sync",
    body:
      "Supplier prices are re-checked hourly. When cost rises, your price follows your rule. When the supplier runs out, the listing is paused instead of selling what you cannot ship.",
  },
  {
    icon: "🛡️",
    title: "VeRO shield + drip posting",
    body:
      "Batches are screened against a brand and keyword blocklist before they go live, and released on a spaced cadence rather than dumped on eBay in one burst.",
  },
  {
    icon: "📦",
    title: "Order and tracking handling",
    body:
      "Sales land in the fulfillment queue with buyer address, supplier cost, and realized margin. Mark it ordered, drop in the tracking number, and the order closes out.",
  },
];

export function Features() {
  return (
    <section id="features" className="border-b border-white/10 bg-navy-900 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">What you get</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            Built around the listing engine
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            Bulk listing is the product. Everything else — research, pricing, repricing, orders — exists so the
            listings you push out stay accurate and profitable after they go live.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article
              key={feature.title}
              className={`ap-card rounded-2xl p-5 transition hover:border-brand-500/40 ${
                feature.flagship ? "border-brand-500/35 bg-brand-500/[0.06]" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span aria-hidden className="text-2xl">
                  {feature.icon}
                </span>
                {feature.flagship ? (
                  <span className="rounded-full bg-lime-brand/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-lime-brand">
                    Core
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 text-base font-semibold text-white">{feature.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
