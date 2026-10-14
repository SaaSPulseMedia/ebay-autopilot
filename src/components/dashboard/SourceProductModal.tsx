"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CjProductDetail } from "@/lib/cj/catalog";

export type SourceOrigin = "US" | "CN" | null;

/** What the card grid already knows about a product; shown while the detail loads. */
export type SourceModalItem = {
  pid: string;
  title: string;
  imageUrl: string | null;
  price: number;
  listedNum: number;
  origin: SourceOrigin;
};

export type AddState = "adding" | "added" | { error: string };

const money = (n: number) => `$${n.toFixed(2)}`;

export function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden="true">
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" strokeLinejoin="round" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" strokeLinejoin="round" />
    </svg>
  );
}

export function OriginBadge({ origin }: { origin: SourceOrigin }) {
  if (!origin) return null;
  return origin === "US" ? (
    <span
      title="In stock at CJ's US warehouse"
      className="rounded-full border border-lime-brand/30 bg-lime-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-lime-brand"
    >
      Ships from US
    </span>
  ) : (
    <span
      title="Not found in CJ's US warehouse; ships from China"
      className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300"
    >
      Ships from CN
    </span>
  );
}

/** Image that swaps to a box icon when the URL is missing or fails. */
function SafeImage({ src, className, iconClass }: { src: string | null; className: string; iconClass: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <BoxIcon className={iconClass} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" className={className} onError={() => setFailed(true)} />
  );
}

function priceText(product: CjProductDetail) {
  if (!product.priceMax) return "—";
  return product.priceMin === product.priceMax ? money(product.priceMin) : `${money(product.priceMin)} – ${money(product.priceMax)}`;
}

function weightText(min: number, max: number) {
  if (!max) return "—";
  return min === max ? `${min} g` : `${min}–${max} g`;
}

type DetailState = { status: "loading" } | { status: "error"; message: string } | { status: "done"; product: CjProductDetail };

type Props = {
  item: SourceModalItem;
  addState: AddState | undefined;
  onAdd: (pid: string) => void;
  onClose: () => void;
  /** Details already fetched this session, keyed by pid (avoids re-calling CJ). */
  cache: Map<string, CjProductDetail>;
};

export function SourceProductModal({ item, addState, onAdd, onClose, cache }: Props) {
  const cached = cache.get(item.pid);
  const [state, setState] = useState<DetailState>(cached ? { status: "done", product: cached } : { status: "loading" });
  const [active, setActive] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/source/detail?pid=${encodeURIComponent(item.pid)}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setState({ status: "error", message: body?.error ?? `Couldn't load this product (HTTP ${res.status}).` });
        return;
      }
      cache.set(item.pid, body.product);
      setState({ status: "done", product: body.product });
    } catch {
      setState({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }, [cache, item.pid]);

  useEffect(() => {
    // Only fetch on open when there's nothing cached; retries call load() directly.
    if (!cache.has(item.pid)) void load(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [cache, item.pid, load]);

  // Escape closes the enlarged image first, then the modal. Page scroll is locked while open.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (enlarged) setEnlarged(false);
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
  const images = product?.images.length ? product.images : item.imageUrl ? [item.imageUrl] : [];
  const mainImage = images[Math.min(active, Math.max(0, images.length - 1))] ?? null;
  const added = addState === "added";
  const adding = addState === "adding";
  const addError = typeof addState === "object" ? addState.error : null;
  const sellers = product?.listedNum ?? item.listedNum;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        tabIndex={-1}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-white/10 bg-navy-950 shadow-2xl outline-none sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="source-modal-title" className="text-lg font-semibold leading-snug text-white">
              {product?.productNameEn || item.title}
            </h2>
            {product?.productName && product.productName !== product.productNameEn ? (
              <p className="mt-0.5 text-sm text-slate-400">{product.productName}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full border border-white/15 p-1.5 text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => mainImage && setEnlarged(true)}
                disabled={!mainImage}
                aria-label="Enlarge image"
                className="relative flex aspect-square w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-xl bg-white/5 text-slate-500 disabled:cursor-default"
              >
                <SafeImage key={mainImage ?? "none"} src={mainImage} className="absolute inset-0 h-full w-full object-contain" iconClass="h-12 w-12" />
              </button>
              {images.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((src, i) => (
                    <button
                      key={src}
                      type="button"
                      onClick={() => setActive(i)}
                      aria-label={`Show image ${i + 1}`}
                      className={`relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/5 text-slate-500 ring-2 ${
                        i === active ? "ring-brand-500" : "ring-transparent hover:ring-white/20"
                      }`}
                    >
                      <SafeImage src={src} className="absolute inset-0 h-full w-full object-cover" iconClass="h-5 w-5" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5">
                <OriginBadge origin={item.origin} />
                {product?.category ? <span className="text-xs text-slate-400">{product.category}</span> : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <dt className="text-xs text-slate-400">CJ price</dt>
                  <dd className="mt-0.5 font-semibold text-white">{product ? priceText(product) : money(item.price)}</dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <dt className="text-xs text-slate-400">Sellers listing it</dt>
                  <dd className="mt-0.5 font-semibold text-white">{sellers.toLocaleString()}</dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <dt className="text-xs text-slate-400">Weight</dt>
                  <dd className="mt-0.5 font-semibold text-white">
                    {product ? weightText(product.weightMinGrams, product.weightMaxGrams) : "…"}
                  </dd>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <dt className="text-xs text-slate-400">Variants</dt>
                  <dd className="mt-0.5 font-semibold text-white">{product ? product.variants.length : "…"}</dd>
                </div>
              </dl>
              {product?.productSku ? <p className="text-xs text-slate-400">CJ SKU: {product.productSku}</p> : null}

              {state.status === "loading" ? (
                <div className="animate-pulse space-y-2" aria-busy="true" aria-label="Loading details">
                  <div className="h-3 w-full rounded bg-white/5" />
                  <div className="h-3 w-5/6 rounded bg-white/5" />
                  <div className="h-3 w-2/3 rounded bg-white/5" />
                </div>
              ) : null}
              {state.status === "error" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
                  <span>{state.message}</span>
                  <button
                    type="button"
                    onClick={() => void load()}
                    className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5"
                  >
                    Try again
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {product ? (
            <>
              <section>
                <h3 className="mb-2 text-sm font-semibold text-white">Description</h3>
                {product.descriptionHtml ? (
                  <div
                    className="space-y-2 text-sm leading-relaxed text-slate-300 [&_h4]:mt-3 [&_h4]:font-semibold [&_h4]:text-white [&_li]:ml-5 [&_ol]:list-decimal [&_strong]:text-white [&_b]:text-white [&_table]:w-full [&_td]:border [&_td]:border-white/10 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-white/10 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc"
                    // Sanitized server-side by sanitizeCjDescription: allowlisted tags only, no attributes.
                    dangerouslySetInnerHTML={{ __html: product.descriptionHtml }}
                  />
                ) : (
                  <p className="text-sm text-slate-400">CJ has no description for this product.</p>
                )}
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold text-white">Variants ({product.variants.length})</h3>
                {product.variants.length ? (
                  <div className="overflow-x-auto rounded-xl border border-white/10">
                    <table className="w-full min-w-[640px] text-left text-xs">
                      <thead className="bg-white/[0.03] text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">Color</th>
                          <th className="px-3 py-2 font-medium">Size</th>
                          <th className="px-3 py-2 font-medium">SKU</th>
                          <th className="px-3 py-2 text-right font-medium">Price</th>
                          <th className="px-3 py-2 text-right font-medium">Weight</th>
                          <th className="px-3 py-2 font-medium">L × W × H (mm)</th>
                          <th className="px-3 py-2 font-medium">Barcode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {product.variants.map((v, i) => (
                          <tr key={v.vid || v.sku || i}>
                            <td className="px-3 py-2">{v.color ?? (v.key || "—")}</td>
                            <td className="px-3 py-2">{v.size ?? "—"}</td>
                            <td className="px-3 py-2 font-mono text-[11px]">{v.sku || "—"}</td>
                            <td className="px-3 py-2 text-right text-white">{v.price != null ? money(v.price) : "—"}</td>
                            <td className="px-3 py-2 text-right">{v.weightGrams != null ? `${v.weightGrams} g` : "—"}</td>
                            <td className="px-3 py-2">
                              {v.dimensions ? `${v.dimensions.length} × ${v.dimensions.width} × ${v.dimensions.height}` : "—"}
                            </td>
                            <td className="px-3 py-2 font-mono text-[11px]">{v.barcode || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">CJ lists no variants for this product.</p>
                )}
              </section>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 px-5 py-4">
          {addError ? <p className="mr-auto text-xs text-red-300">{addError}</p> : null}
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onAdd(item.pid)}
            disabled={added || adding}
            className={
              added
                ? "rounded-full border border-lime-brand/30 bg-lime-brand/10 px-5 py-2 text-sm font-semibold text-lime-brand"
                : "rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            }
          >
            {added ? "Added ✓" : adding ? "Adding…" : addError ? "Try again" : "Add to my catalog"}
          </button>
        </div>
      </div>

      {enlarged && mainImage ? (
        <div
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
          onMouseDown={(event) => {
            event.stopPropagation();
            setEnlarged(false);
          }}
          role="presentation"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mainImage} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      ) : null}
    </div>
  );
}
