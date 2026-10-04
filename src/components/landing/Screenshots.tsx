import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Real product screenshots.
 *
 * Drop a file into `public/images/screenshots/` using the slug below and it
 * appears here automatically — no code change needed. Any slot without a file
 * renders a capture prompt instead, so we never ship a fake or stock image
 * pretending to be the product. See docs/SCREENSHOTS.md for the rules.
 */
const shots = [
  {
    slug: "bulk-run",
    caption: "Selecting a batch and pressing List selected",
    blurb: "The bulk runner with products ticked and the live variant and profit totals.",
    wide: true,
  },
  {
    slug: "variants",
    caption: "Variants built automatically",
    blurb: "Size and colour rows generated for a single product, each with its own SKU.",
    wide: false,
  },
  {
    slug: "research",
    caption: "Research with the margin maths shown",
    blurb: "Supplier cost, suggested price, and net profit after eBay's fees.",
    wide: false,
  },
];

function shotExists(slug: string) {
  const dir = path.join(process.cwd(), "public", "images", "screenshots");
  for (const ext of ["png", "jpg", "jpeg", "webp"]) {
    const file = path.join(dir, `${slug}.${ext}`);
    if (existsSync(file)) return `/images/screenshots/${slug}.${ext}`;
  }
  return null;
}

export function Screenshots() {
  const resolved = shots.map((shot) => ({ ...shot, src: shotExists(shot.slug) }));
  const anyPresent = resolved.some((shot) => shot.src);

  // Nothing captured yet — render nothing rather than a wall of placeholders.
  if (!anyPresent) return null;

  return (
    <section id="screenshots" className="border-b border-white/10 bg-navy-900 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-5">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-400">Inside the app</p>
          <h2 className="mt-3 text-[clamp(1.9rem,3.6vw,2.7rem)] font-bold leading-tight tracking-tight text-white">
            What it actually looks like
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-300">
            Screenshots from a real store running on AutoPilot. Buyer names and addresses are blanked out; everything
            else is untouched.
          </p>
        </div>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {resolved
            .filter((shot) => shot.src)
            .map((shot) => (
              <figure
                key={shot.slug}
                className={`ap-card overflow-hidden rounded-2xl ${shot.wide ? "lg:col-span-2" : ""}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={shot.src as string}
                  alt={shot.caption}
                  loading="lazy"
                  className="w-full border-b border-white/10 bg-navy-950 object-cover"
                />
                <figcaption className="p-5">
                  <p className="text-base font-semibold text-white">{shot.caption}</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">{shot.blurb}</p>
                </figcaption>
              </figure>
            ))}
        </div>
      </div>
    </section>
  );
}
