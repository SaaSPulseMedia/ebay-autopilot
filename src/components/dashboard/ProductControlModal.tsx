"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { CjShippingQuote } from "@/lib/cj/catalog";
import { EBAY_FIXED_FEE } from "@/lib/pricing";
import type { ProductControl } from "@/lib/product-control";

/** Which product to show, and what the row already knows (shown while the details load). */
export type ProductControlTarget = ({ listingId: number } | { externalId: string }) & {
  title: string;
  imageUrl: string | null;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "done"; product: ProductControl };
type ShippingState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "done"; quote: CjShippingQuote };

const money = (n: number) => `$${n.toFixed(2)}`;

const LIVE_LABEL = {
  active: "Live on eBay",
  ended: "Not live on eBay",
  unknown: "Couldn't reach eBay",
  not_checked: "",
} as const;

function endpoint(target: ProductControlTarget) {
  return "listingId" in target
    ? `/api/listings/${target.listingId}`
    : `/api/catalog/${encodeURIComponent(target.externalId)}`;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <dt className="text-slate-400">{label}</dt>
      <dd className={strong ? "font-semibold text-white" : "text-slate-200"}>{value}</dd>
    </div>
  );
}

const FROM_LABEL = { CN: "China warehouse", US: "US warehouse" } as const;

/** CJ's real shipping price to the US: the cheapest method, with the others listed under it. */
function CjShipping({ state, onRetry }: { state: ShippingState; onRetry: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <p className="py-1 text-xs text-slate-400">Getting CJ&apos;s shipping price…</p>;
  if (state.status === "error") {
    return (
      <p className="py-1 text-xs text-amber-200">
        Couldn&apos;t get CJ&apos;s shipping price: {state.message}{" "}
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      </p>
    );
  }
  const [cheapest, ...others] = state.quote.options;
  if (!cheapest) return <p className="py-1 text-xs text-amber-200">CJ has no shipping method to the US for this product.</p>;
  return (
    <div className="py-1">
      <p className="text-[11px] text-slate-500">
        Cheapest: {cheapest.method} from CJ&apos;s {FROM_LABEL[cheapest.from]}
        {cheapest.days ? `, ${cheapest.days} days` : ""}
        {state.quote.variant ? ` · quoted for ${state.quote.variant}` : ""}
      </p>
      {others.length ? (
        <details className="mt-1 text-[11px] text-slate-400">
          <summary className="cursor-pointer text-slate-300">
            {others.length} other method{others.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {others.slice(0, 8).map((o) => (
              <li key={`${o.from}:${o.method}`} className="flex justify-between gap-3">
                <span>
                  {o.method} · {o.from}
                  {o.days ? ` · ${o.days} days` : ""}
                </span>
                <span className="text-slate-200">{money(o.price)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Product Control Center: one screen with the product's large photos, CJ cost
 * and link, the eBay listing's live price and link, sizes, and CJ's
 * description with its size chart, for answering buyer questions quickly.
 */
export function ProductControlModal({ target, onClose }: { target: ProductControlTarget; onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [active, setActive] = useState(0);
  const [enlarged, setEnlarged] = useState<string | null>(null);
  const [shipping, setShipping] = useState<ShippingState>({ status: "idle" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const url = endpoint(target);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(url);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setState({ status: "error", message: body?.error ?? `Couldn't load this product (HTTP ${res.status}).` });
        return;
      }
      setState({ status: "done", product: body.product });
    } catch {
      setState({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }, [url]);

  useEffect(() => {
    void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  // CJ's real shipping price, asked for once the product (and so its CJ id) is known.
  const pid = state.status === "done" ? (state.product.cj?.pid ?? null) : null;
  const quoteSku = state.status === "done" ? (state.product.cj?.quoteSku ?? null) : null;
  const loadShipping = useCallback(async () => {
    if (!pid) return;
    setShipping({ status: "loading" });
    try {
      const params = new URLSearchParams({ pid });
      if (quoteSku) params.set("sku", quoteSku);
      const res = await fetch(`/api/source/shipping?${params}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setShipping({ status: "error", message: body?.error ?? `HTTP ${res.status}` });
        return;
      }
      setShipping({ status: "done", quote: { variant: body.variant, options: body.options, usStock: body.usStock ?? null } });
    } catch {
      setShipping({ status: "error", message: "couldn't reach AutoPilot" });
    }
  }, [pid, quoteSku]);

  useEffect(() => {
    void loadShipping(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadShipping]);

  // Escape closes the enlarged image first, then the modal. Page scroll is locked while open.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (enlarged) setEnlarged(null);
      else onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enlarged, onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const product = state.status === "done" ? state.product : null;
  const images = product?.images.length ? product.images : target.imageUrl ? [target.imageUrl] : [];
  const mainImage = images[Math.min(active, Math.max(0, images.length - 1))] ?? null;
  const ebay = product?.ebay ?? null;
  const cj = product?.cj ?? null;
  const realShipping = shipping.status === "done" ? (shipping.quote.options[0]?.price ?? null) : null;

  // Portalled to <body>: inside a table card (backdrop blur), `fixed` would be clipped to the card.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Product details: ${target.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-navy-950 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold leading-snug text-white">{product?.title || target.title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 text-sm text-slate-300 hover:bg-white/5"
          >
            ✕
          </button>
        </div>

        <div className="grid gap-6 overflow-y-auto p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <button
              type="button"
              onClick={() => mainImage && setEnlarged(mainImage)}
              disabled={!mainImage}
              aria-label="Enlarge image"
              className="flex aspect-square w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-white text-slate-500 disabled:cursor-default disabled:bg-white/5"
            >
              {mainImage ? (
                // eslint-disable-next-line @next/next/no-img-element -- supplier images at full size, from any host
                <img src={mainImage} alt={target.title} className="h-full w-full object-contain" />
              ) : (
                <span className="text-sm">No image</span>
              )}
            </button>
            {images.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((src, index) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setActive(index)}
                    aria-label={`Show image ${index + 1}`}
                    className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-white ring-2 ${
                      index === active ? "ring-brand-500" : "ring-transparent hover:ring-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- supplier thumbnails */}
                    <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="space-y-5">
            {state.status === "loading" ? <p className="text-sm text-slate-400">Loading product details…</p> : null}
            {state.status === "error" ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                {state.message}{" "}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Try again
                </button>
              </div>
            ) : null}

            {product ? (
              <>
                <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">CJ Dropshipping</h3>
                  {cj ? (
                    <>
                      <dl className="mt-2">
                        <Row label="Base cost" value={money(cj.baseCost)} />
                        {realShipping != null ? (
                          <Row label="CJ shipping to US" value={money(realShipping)} />
                        ) : (
                          <Row
                            label={cj.shippingQuoted ? "CJ shipping (quoted on import)" : "Shipping (old estimate)"}
                            value={cj.shipping == null ? "—" : money(cj.shipping)}
                          />
                        )}
                        <CjShipping state={shipping} onRetry={() => void loadShipping()} />
                        <Row label="eBay order fee" value={money(EBAY_FIXED_FEE)} />
                        <Row
                          label={realShipping != null || cj.shippingQuoted ? "Total landed cost" : "Total landed cost (estimate)"}
                          value={money(realShipping != null ? cj.baseCost + realShipping + EBAY_FIXED_FEE : cj.landed)}
                          strong
                        />
                      </dl>
                      {cj.url ? (
                        <a
                          href={cj.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-brand-500 px-4 py-2 text-sm font-bold text-white hover:bg-brand-400"
                        >
                          Open in CJ Dropshipping ↗
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Not a CJ product, or its catalog entry was deleted.</p>
                  )}
                </section>

                <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">eBay listing</h3>
                  {ebay ? (
                    <>
                      <dl className="mt-2">
                        <Row
                          label="Live eBay price"
                          value={ebay.livePrice != null ? money(ebay.livePrice) : "—"}
                          strong
                        />
                        <Row label="Listed by AutoPilot at" value={money(ebay.listedPrice)} />
                        <Row label="Shipping" value={ebay.freeShipping ? "Free shipping" : "Your shipping policy"} />
                        <Row label="Status" value={LIVE_LABEL[ebay.live] || ebay.status} />
                        {ebay.itemId ? <Row label="Item number" value={ebay.itemId} /> : null}
                      </dl>
                      {ebay.url ? (
                        <a
                          href={ebay.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex w-full items-center justify-center rounded-full bg-lime-brand px-4 py-2 text-sm font-bold text-navy-950 hover:brightness-110"
                        >
                          View on eBay ↗
                        </a>
                      ) : (
                        <p className="mt-2 text-xs text-slate-400">
                          {ebay.status === "scheduled"
                            ? "Scheduled for drip posting: the eBay link appears once it goes live."
                            : "Not published through the eBay API, so there is no eBay link."}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-slate-400">Not listed on eBay yet.</p>
                  )}
                </section>

                {product.sizes.length || product.variants.length ? (
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      {product.sizes.length ? "Sizes" : "Options"}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {(product.sizes.length ? product.sizes : product.variants).map((option) => (
                        <span key={option} className="rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-slate-200">
                          {option}
                        </span>
                      ))}
                    </div>
                    {product.sizes.length && product.variants.length > product.sizes.length ? (
                      <p className="mt-1.5 text-[11px] text-slate-500">{product.variants.length} variants in all.</p>
                    ) : null}
                  </section>
                ) : null}
              </>
            ) : null}
          </div>

          {product && (product.descriptionImages.length || product.specs.length || product.description) ? (
            <div className="space-y-4 md:col-span-2">
              {product.descriptionImages.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Size chart &amp; details from CJ
                  </h3>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    {product.descriptionImages.map((src) => (
                      <button
                        key={src}
                        type="button"
                        onClick={() => setEnlarged(src)}
                        className="cursor-zoom-in overflow-hidden rounded-xl bg-white"
                        aria-label="Enlarge image"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- CJ description images */}
                        <img src={src} alt="" loading="lazy" className="w-full object-contain" />
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {product.specs.length ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Specifications</h3>
                  <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
                    {product.specs.map((spec) => (
                      <Row key={`${spec.name}:${spec.value}`} label={spec.name} value={spec.value} />
                    ))}
                  </dl>
                </section>
              ) : null}
              {product.description ? (
                <section>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Description</h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-300">{product.description}</p>
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {enlarged ? (
        <div
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setEnlarged(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- full-size supplier image */}
          <img src={enlarged} alt={target.title} className="max-h-full max-w-full object-contain" />
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
