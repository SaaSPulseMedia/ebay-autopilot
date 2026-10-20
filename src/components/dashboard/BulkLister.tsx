"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useMemo, useState } from "react";

import { BatchSummary, DripToggle, type BatchResponse } from "@/components/dashboard/BatchControls";
import { ImageManager } from "@/components/dashboard/ImageManager";
import { PriceBreakdown } from "@/components/dashboard/PriceBreakdown";
import { MARKET_MATCH_BUFFER, type PriceBreakdown as Breakdown } from "@/lib/pricing";

export type BulkProduct = {
  externalId: string;
  title: string;
  category: string;
  supplierPrice: number;
  listPrice: number;
  breakdown: Breakdown;
  variants: number;
  veroRisk: "low" | "medium" | "high";
  veroMatch: string | null;
  veroReason: string;
  /** Primary product image; null or empty shows the placeholder. */
  imageUrl: string | null;
  /** Images the listing will use (the seller's set when saved, else the supplier's). */
  imageCount: number;
  /** True when the seller saved their own image order or uploads. */
  customImages: boolean;
  /** False for the shared sample products, which no seller can delete. */
  deletable: boolean;
  /** Market Match result (only with that pricing rule; filled in after the page loads). */
  pricing?: PricingNote;
};

/** Which pricing rule a product gets under "Match eBay Market Price (Free Shipping)". */
type PricingNote = { rule: "market" | "default"; market: number | null; marketSource?: "sold" | "active" | null; reason?: string };

type PricePreview = PricingNote & { externalId: string; listPrice: number; breakdown: Breakdown };

/** Products asked for per /api/pricing/preview call (each needs an eBay lookup). */
const PREVIEW_BATCH = 15;

function BoxIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden="true">
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z" strokeLinejoin="round" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 48×48 product thumbnail. The image stays invisible until it has loaded, so the
 * tile shows a soft placeholder meanwhile and never a broken-image icon; a box
 * icon replaces it when there is no URL or the image fails.
 */
function ProductThumb({ src }: { src: string | null }) {
  const [state, setState] = useState<"loading" | "loaded" | "failed">("loading");
  const url = src?.trim();
  const showImage = Boolean(url) && state !== "failed";
  return (
    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-white/5 text-slate-500">
      {showImage ? null : <BoxIcon className="h-5 w-5" />}
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-12 w-12 object-cover transition-opacity ${state === "loaded" ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setState("loaded")}
          onError={() => setState("failed")}
          // Load/error events that fired before hydration are missed, so read the state on mount.
          ref={(img) => {
            if (img?.complete) setState(img.naturalWidth > 0 ? "loaded" : "failed");
          }}
        />
      ) : null}
    </div>
  );
}

/** "eBay sold $42.00" (last 90 days' sales) or "eBay active $42.00" (lower quartile of listings up now). */
function marketLabel(note: PricingNote) {
  if (note.market == null) return "";
  return `eBay ${note.marketSource === "sold" ? "sold" : "active"} $${note.market.toFixed(2)}`;
}

/** "Market Match" or "Default Margin" under a product, for the Market Match pricing rule. */
function PricingRuleNote({ note }: { note?: PricingNote }) {
  if (!note) return <span className="mt-0.5 block text-[11px] text-slate-500">Checking eBay market price…</span>;
  if (note.rule === "market") {
    return (
      <span
        className="mt-0.5 block text-[11px] text-lime-brand"
        title={`Priced at the ${note.marketSource === "sold" ? "eBay sold price (last 90 days)" : "competitive end of active eBay listings"} + $${MARKET_MATCH_BUFFER.toFixed(2)}, with free shipping.`}
      >
        Market Match · {marketLabel(note)} · free shipping
      </span>
    );
  }
  return (
    <span className="mt-0.5 block text-[11px] text-slate-400" title="Suggested price (about 23% margin) with your normal shipping.">
      Default Margin · {note.reason ?? "market price too low"}
      {note.market != null ? ` (${marketLabel(note)})` : ""}
    </span>
  );
}

type Props = {
  products: BulkProduct[];
  /** Seller uses "Match eBay Market Price (Free Shipping)": prices are looked up after load. */
  marketMode?: boolean;
  batchSize: number;
  activeListings: number;
  activeUsed: number;
  planName: string;
  isTrial: boolean;
  dripAllowed: boolean;
  dripPerRun: number;
};


export function BulkLister({
  products: initialProducts,
  marketMode = false,
  batchSize,
  activeListings,
  activeUsed,
  planName,
  isTrial,
  dripAllowed,
  dripPerRun,
}: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingImages, setEditingImages] = useState<BulkProduct | null>(null);
  const [deleting, setDeleting] = useState<BulkProduct | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<BatchResponse | null>(null);
  const [drip, setDrip] = useState(false);
  const [openWhy, setOpenWhy] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, PricePreview>>({});

  // Market Match needs each product's eBay market price: fetch it in batches
  // after the page renders, so the list never waits on eBay.
  useEffect(() => {
    if (!marketMode) return;
    let cancelled = false;
    (async () => {
      const ids = initialProducts.map((p) => p.externalId);
      for (let i = 0; i < ids.length && !cancelled; i += PREVIEW_BATCH) {
        try {
          const res = await fetch("/api/pricing/preview", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ externalIds: ids.slice(i, i + PREVIEW_BATCH) }),
          });
          const body = (await res.json().catch(() => null)) as { ok?: boolean; prices?: PricePreview[] } | null;
          if (cancelled || !body?.ok || !body.prices) continue;
          const batch = body.prices;
          setPreviews((prev) => ({ ...prev, ...Object.fromEntries(batch.map((p) => [p.externalId, p])) }));
        } catch {
          // Leave these rows on the fallback price; publishing prices them again anyway.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketMode, initialProducts]);

  const products = useMemo(
    () =>
      initialProducts.map((p) => {
        const preview = previews[p.externalId];
        return preview
          ? {
              ...p,
              listPrice: preview.listPrice,
              breakdown: preview.breakdown,
              pricing: {
                rule: preview.rule,
                market: preview.market,
                marketSource: preview.marketSource,
                reason: preview.reason,
              },
            }
          : p;
      }),
    [initialProducts, previews],
  );

  const visible = useMemo(
    () => (query ? products.filter((p) => p.title.toLowerCase().includes(query.toLowerCase())) : products),
    [products, query],
  );

  const chosen = products.filter((p) => selected.has(p.externalId));
  const projectedProfit = chosen.reduce((sum, p) => sum + p.breakdown.profit, 0);
  const projectedVariants = chosen.reduce((sum, p) => sum + p.variants, 0);
  const remaining = Math.max(0, activeListings - activeUsed);
  const perRunCap = Math.min(batchSize, remaining);
  const overLimit = selected.size > perRunCap;
  const atCapacity = remaining === 0;

  // Brand-blocked and money-losing products cannot be selected.
  const isUnlistable = (p: BulkProduct) => p.veroRisk === "high" || p.breakdown.profit <= 0;
  const blockedIds = useMemo(
    () => new Set(products.filter((p) => p.veroRisk === "high" || p.breakdown.profit <= 0).map((p) => p.externalId)),
    [products],
  );

  function toggle(id: string) {
    if (blockedIds.has(id)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAllVisible() {
    setSelected(
      new Set(
        visible
          .filter((p) => !isUnlistable(p))
          .slice(0, perRunCap)
          .map((p) => p.externalId),
      ),
    );
  }

  async function listSelected() {
    setBusy(true);
    setSummary(null);
    try {
      const res = await fetch("/api/listings/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ externalIds: Array.from(selected), drip: dripAllowed && drip }),
      });
      const json = (await res.json()) as BatchResponse;
      setSummary(json);
      if (json.ok) {
        setSelected(new Set());
        router.refresh();
      }
    } catch {
      setSummary({ ok: false, error: "The batch could not be sent. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="ap-card sticky top-[116px] z-30 rounded-2xl p-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter products…"
            className="min-w-[180px] flex-1 rounded-xl border border-white/15 bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
          />
          <button
            type="button"
            onClick={selectAllVisible}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            Select {Math.min(visible.filter((p) => !isUnlistable(p)).length, perRunCap)}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={listSelected}
            disabled={busy || !selected.size || overLimit || atCapacity}
            className="ap-glow rounded-full bg-brand-500 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-brand-400 disabled:opacity-50 disabled:shadow-none"
          >
            {busy
              ? `Listing ${selected.size}…`
              : `⚡ ${dripAllowed && drip ? "Schedule" : "List"} selected (${selected.size})`}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
          <span>
            Plan: <span className="text-white">{planName}</span>
            {isTrial ? " (trial)" : ""} · up to <span className="text-white">{batchSize}</span> per run
          </span>
          <span>
            Active listings:{" "}
            <span className={remaining <= 5 ? "text-amber-300 font-semibold" : "text-white"}>
              {activeUsed}/{activeListings}
            </span>{" "}
            · {remaining} slot{remaining === 1 ? "" : "s"} left
          </span>
          <span>
            Variants to build: <span className="text-white">{projectedVariants}</span>
          </span>
          <span>
            Projected profit per unit sold: <span className="text-lime-brand">${projectedProfit.toFixed(2)}</span>
          </span>
        </div>

        <div className="mt-3">
          <DripToggle allowed={dripAllowed} checked={drip} perRun={dripPerRun} onChange={setDrip} />
        </div>

        {atCapacity ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
            <span>
              You are using all {activeListings} active listings on {planName}. End some listings or upgrade to keep
              publishing.
            </span>
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center gap-1 font-semibold text-lime-brand underline hover:text-white"
            >
              Upgrade in Billing →
            </Link>
          </div>
        ) : overLimit ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
            <span>
              You selected {selected.size}, but you can publish {perRunCap} right now
              {remaining < batchSize
                ? ` — only ${remaining} of your ${activeListings} ${planName} listing slots are free.`
                : ` on ${planName} (${batchSize} per run).`}{" "}
              Deselect some, or upgrade for more room.
            </span>
            <Link
              href="/dashboard/billing"
              className="inline-flex items-center gap-1 font-semibold text-lime-brand underline hover:text-white"
            >
              Upgrade in Billing →
            </Link>
          </div>
        ) : null}
      </div>

      {summary ? <BatchSummary summary={summary} perRun={dripPerRun} /> : null}

      <div className="ap-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="hidden w-16 py-3 pl-4 sm:table-cell">
                <span className="sr-only">Product photo</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-4 w-4" aria-hidden="true">
                  <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
                  <circle cx="9" cy="10" r="1.6" />
                  <path d="m20.5 16-5-5-8.5 8.5" strokeLinejoin="round" />
                </svg>
              </th>
              <th className="w-10 px-4 py-3" />
              <th className="px-4 py-3">Product</th>
              <th className="px-4 py-3 text-right">Cost</th>
              <th className="px-4 py-3 text-right">List at</th>
              <th className="px-4 py-3 text-right">Net profit</th>
              <th className="px-4 py-3 text-right">Variants</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((product) => {
              const isOn = selected.has(product.externalId);
              const isBlocked = isUnlistable(product);
              const losing = product.breakdown.profit <= 0;
              const whyOpen = openWhy === product.externalId;
              return (
                <Fragment key={product.externalId}>
                <tr
                  onClick={() => toggle(product.externalId)}
                  title={product.veroRisk !== "low" ? product.veroReason : losing ? "Loses money at your current pricing" : undefined}
                  className={`border-b border-white/5 last:border-0 ${
                    isBlocked
                      ? "cursor-not-allowed opacity-50"
                      : isOn
                        ? "cursor-pointer bg-brand-500/10"
                        : "cursor-pointer hover:bg-white/[0.03]"
                  }`}
                >
                  <td className="hidden py-2 pl-4 sm:table-cell">
                    <ProductThumb src={product.imageUrl} />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      disabled={isBlocked}
                      checked={isOn}
                      onChange={() => toggle(product.externalId)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${product.title}`}
                    />
                  </td>
                  <td className="max-w-[320px] px-4 py-3">
                    <span className="block truncate font-medium text-white">{product.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingImages(product);
                      }}
                      className="my-1 inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:border-white/30 hover:text-white"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
                        <rect x="3" y="5" width="18" height="14" rx="2" />
                        <path d="m3 16 5-5 4 4 3-3 6 6" strokeLinejoin="round" />
                        <circle cx="15.5" cy="9.5" r="1.5" />
                      </svg>
                      Edit images
                      <span className="text-slate-500">
                        · {product.imageCount}
                        {product.customImages ? " · custom" : ""}
                      </span>
                    </button>
                    {product.deletable ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(product);
                        }}
                        title="Delete from catalog"
                        aria-label={`Delete ${product.title} from catalog`}
                        className="my-1 ml-1.5 inline-flex items-center rounded-full border border-white/15 p-1.5 text-slate-400 hover:border-red-400/50 hover:text-red-300"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5" aria-hidden="true">
                          <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : null}
                    <span className="block text-[11px] text-slate-500">
                      {product.category}
                      {product.veroRisk === "high" ? (
                        <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                          Brand blocked
                        </span>
                      ) : losing ? (
                        <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                          Loses money
                        </span>
                      ) : product.veroRisk === "medium" ? (
                        <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-200">
                          {product.veroMatch ? "Brand mentioned" : "Brand-sensitive"}
                        </span>
                      ) : null}
                    </span>
                    {marketMode ? <PricingRuleNote note={product.pricing} /> : null}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">${product.supplierPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">${product.listPrice.toFixed(2)}</td>
                  <td className={`px-4 py-3 text-right ${losing ? "text-red-300" : "text-lime-brand"}`}>
                    ${product.breakdown.profit.toFixed(2)}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenWhy(whyOpen ? null : product.externalId);
                      }}
                      className="ml-2 rounded-full border border-white/15 px-2 py-0.5 text-[10px] font-semibold text-slate-300 hover:bg-white/5"
                      aria-expanded={whyOpen}
                    >
                      Why?
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">{product.variants}</td>
                </tr>
                {whyOpen ? (
                  <tr className="border-b border-white/5">
                    <td className="hidden sm:table-cell" />
                    <td />
                    <td colSpan={5} className="px-4 pb-4">
                      <div className="max-w-md">
                        <PriceBreakdown breakdown={product.breakdown} compact />
                      </div>
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {editingImages ? (
        <ImageManager
          externalId={editingImages.externalId}
          title={editingImages.title}
          onClose={() => setEditingImages(null)}
          // Re-render the page so the row's thumbnail and image count update.
          onChanged={() => router.refresh()}
        />
      ) : null}
      {deleting ? (
        <DeleteFromCatalog
          product={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setSelected((prev) => {
              const next = new Set(prev);
              next.delete(deleting.externalId);
              return next;
            });
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DeleteFromCatalog({
  product,
  onClose,
  onDeleted,
}: {
  product: BulkProduct;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(product.externalId)}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (res.ok && data?.ok) return onDeleted();
      setError(data?.error ?? "Could not delete this product. Try again.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={busy ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-catalog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-navy-950 p-6 shadow-2xl"
      >
        <h2 id="delete-catalog-title" className="text-base font-semibold text-white">
          Delete from catalog
        </h2>
        <p className="mt-1 truncate text-xs text-slate-500">{product.title}</p>
        <p className="mt-4 text-sm text-slate-300">Delete this product from your catalog? This does not affect eBay listings.</p>
        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-full border border-white/15 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={busy}
            className="rounded-full bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400 disabled:opacity-50"
          >
            {busy ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
