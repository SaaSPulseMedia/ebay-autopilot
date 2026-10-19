"use client";

import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type AddState, SourceProductModal } from "@/components/dashboard/SourceProductModal";
import { GRID, OriginDot, ProductImage } from "@/components/dashboard/SourceSearch";
import type { CjCategory, CjProductDetail, WinningProduct } from "@/lib/cj/catalog";
import { NICHES } from "@/lib/niches";

type Sort = "score" | "margin" | "competition" | "newest";

const SORTS: { id: Sort; label: string }[] = [
  { id: "score", label: "Winning Score" },
  { id: "margin", label: "Best margin" },
  { id: "competition", label: "Lowest competition" },
  { id: "newest", label: "Newest" },
];

type Filters = {
  category: string;
  minPrice: string;
  maxPrice: string;
  /** Minimum net profit in USD, 0–20. */
  minProfit: number;
  maxSellers: string;
  usOnly: boolean;
};

const DEFAULT_FILTERS: Filters = { category: "", minPrice: "", maxPrice: "", minProfit: 0, maxSellers: "20", usOnly: false };
const STORAGE_KEY = "autopilot.winning.filters";
const NICHE_KEY = "autopilot.winning.niche";

/** What the last "✨ Auto-Suggest Winners" run searched. */
type Suggestion = {
  niche: string;
  keywords: string[];
  keywordSource: "claude" | "fallback";
  searches: Array<{ keyword: string; found: number; broadenedTo?: string; error?: string }>;
  /** Unique CJ products found, and how many of them the filters hid. */
  pooled: number;
  hiddenByFilters: number;
};

type FeedState =
  | { status: "loading"; suggesting?: string }
  | { status: "error"; message: string; suggesting?: string }
  | { status: "done"; products: WinningProduct[]; suggestion?: Suggestion };

/** Auto-list progress for one product. */
type ListState =
  | { status: "working" }
  | { status: "done"; itemId: string; itemUrl: string; listPrice: number }
  | { status: "error"; message: string; notConnected?: boolean };

const money = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

function loadFilters(): Filters {
  try {
    const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Filters> | null;
    if (!saved) return DEFAULT_FILTERS;
    const text = (v: unknown, fallback: string) => (typeof v === "string" ? v.slice(0, 100) : fallback);
    return {
      category: text(saved.category, ""),
      minPrice: text(saved.minPrice, ""),
      maxPrice: text(saved.maxPrice, ""),
      minProfit: typeof saved.minProfit === "number" ? Math.min(20, Math.max(0, saved.minProfit)) : 0,
      maxSellers: text(saved.maxSellers, "20"),
      usOnly: saved.usOnly === true,
    };
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(filters: Filters) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Storage blocked: filters just won't be remembered.
  }
}

function loadNiche(): string {
  try {
    const saved = window.localStorage.getItem(NICHE_KEY);
    return NICHES.some((n) => n.name === saved) ? (saved as string) : NICHES[0].name;
  } catch {
    return NICHES[0].name;
  }
}

function saveNiche(niche: string) {
  try {
    window.localStorage.setItem(NICHE_KEY, niche);
  } catch {
    // Storage blocked: the niche just won't be remembered.
  }
}

/** "Product Niche" + "✨ Auto-Suggest Winners": Claude-picked keywords searched on CJ. */
function NichePanel({
  niche,
  onNiche,
  onSuggest,
  busy,
}: {
  niche: string;
  onNiche: (niche: string) => void;
  onSuggest: () => void;
  busy: boolean;
}) {
  return (
    <div className="ap-card space-y-3 rounded-2xl p-4">
      <div>
        <label htmlFor="w-niche" className={LABEL}>
          Product Niche
        </label>
        <select id="w-niche" value={niche} onChange={(e) => onNiche(e.target.value)} className={INPUT}>
          {NICHES.map((n) => (
            <option key={n.name} value={n.name}>
              {n.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={onSuggest}
        disabled={busy}
        className="w-full rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-60"
      >
        {busy ? "Finding winners…" : "✨ Auto-Suggest Winners"}
      </button>
      <p className="text-[11px] leading-snug text-slate-500">
        Claude picks 5 product keywords for this niche, AutoPilot searches CJ for each and ranks the results by Winning
        Score. Uses your price, seller, profit and US warehouse filters.
      </p>
    </div>
  );
}

function queryFor(filters: Filters) {
  const params = new URLSearchParams({ limit: "60" });
  if (filters.category) params.set("category", filters.category);
  if (filters.minPrice.trim()) params.set("minPrice", filters.minPrice.trim());
  if (filters.maxPrice.trim()) params.set("maxPrice", filters.maxPrice.trim());
  if (filters.minProfit > 0) params.set("minMargin", String(filters.minProfit));
  params.set("maxSellers", filters.maxSellers.trim() || "any");
  if (filters.usOnly) params.set("usOnly", "1");
  return params.toString();
}

function sortProducts(products: WinningProduct[], sort: Sort) {
  const list = [...products];
  if (sort === "margin") list.sort((a, b) => b.margin - a.margin || b.profit - a.profit);
  else if (sort === "competition") list.sort((a, b) => a.listedNum - b.listedNum || b.winningScore - a.winningScore);
  else if (sort === "newest") list.sort((a, b) => (b.addedAt ?? "").localeCompare(a.addedAt ?? "") || b.winningScore - a.winningScore);
  else list.sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
  return list;
}

function scoreTone(score: number) {
  if (score >= 70) return "bg-lime-brand text-navy-950";
  if (score >= 50) return "bg-amber-300 text-navy-950";
  return "bg-white/80 text-navy-950";
}

function ScoreBadge({ product }: { product: WinningProduct }) {
  const p = product.scoreParts;
  const title = `Winning Score ${product.winningScore}/100 — margin ${Math.round(p.margin * 100)}, competition ${Math.round(
    p.competition * 100,
  )}, US warehouse ${p.us ? "yes" : "no"}, recency ${Math.round(p.recency * 100)}`;
  return (
    <span
      title={title}
      className={`absolute bottom-1.5 left-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold shadow-lg shadow-black/40 ${scoreTone(product.winningScore)}`}
    >
      {product.winningScore}
      <span className="sr-only"> out of 100 Winning Score</span>
    </span>
  );
}

const INPUT =
  "w-full rounded-lg border border-white/15 bg-navy-900 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-brand-500";
const LABEL = "mb-1 block text-xs font-medium text-slate-400";

function FiltersPanel({
  value,
  categories,
  onApply,
  onReset,
}: {
  value: Filters;
  categories: { status: "loading" | "error" | "done"; list: CjCategory[] };
  onApply: (filters: Filters) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const set = (patch: Partial<Filters>) => setDraft((prev) => ({ ...prev, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    onApply(draft);
  }

  return (
    <form onSubmit={submit} className="ap-card space-y-4 rounded-2xl p-4" aria-label="Winning product filters">
      <div>
        <label htmlFor="w-category" className={LABEL}>
          Category
        </label>
        <select
          id="w-category"
          value={draft.category}
          onChange={(e) => set({ category: e.target.value })}
          disabled={categories.status !== "done"}
          className={INPUT}
        >
          <option value="">
            {categories.status === "loading" ? "Loading categories…" : categories.status === "error" ? "Couldn't load" : "Any category"}
          </option>
          {draft.category && !categories.list.some((c) => c.name === draft.category) ? (
            <option value={draft.category}>{draft.category}</option>
          ) : null}
          {categories.list.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={LABEL}>CJ price (USD)</span>
        <div className="flex items-center gap-2">
          <input
            aria-label="Minimum price"
            inputMode="decimal"
            placeholder="Min"
            value={draft.minPrice}
            onChange={(e) => set({ minPrice: e.target.value })}
            className={INPUT}
          />
          <span className="text-slate-500">–</span>
          <input
            aria-label="Maximum price"
            inputMode="decimal"
            placeholder="Max"
            value={draft.maxPrice}
            onChange={(e) => set({ maxPrice: e.target.value })}
            className={INPUT}
          />
        </div>
      </div>
      <div>
        <label htmlFor="w-profit" className={LABEL}>
          Minimum profit per sale: <span className="font-semibold text-white">{money(draft.minProfit)}</span>
        </label>
        <input
          id="w-profit"
          type="range"
          min={0}
          max={20}
          step={0.5}
          value={draft.minProfit}
          onChange={(e) => set({ minProfit: Number(e.target.value) })}
          className="w-full accent-brand-500"
        />
        <div className="flex justify-between text-[10px] text-slate-500">
          <span>$0</span>
          <span>$20</span>
        </div>
      </div>
      <div>
        <label htmlFor="w-sellers" className={LABEL}>
          Maximum sellers
        </label>
        <input
          id="w-sellers"
          inputMode="numeric"
          placeholder="Any"
          value={draft.maxSellers}
          onChange={(e) => set({ maxSellers: e.target.value })}
          className={INPUT}
        />
        <p className="mt-1 text-[11px] text-slate-500">CJ sellers already listing it. Fewer means less competition.</p>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={draft.usOnly}
          onChange={(e) => set({ usOnly: e.target.checked })}
          className="h-4 w-4 accent-lime-500"
        />
        US warehouse only
      </label>
      <div className="flex gap-2">
        <button type="submit" className="flex-1 rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(DEFAULT_FILTERS);
            onReset();
          }}
          className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5"
        >
          Reset
        </button>
      </div>
    </form>
  );
}

/** CJ products ranked by Winning Score, with one-click import + publish. */
export function WinningProducts() {
  const [filters, setFilters] = useState<Filters | null>(null);
  const [sort, setSort] = useState<Sort>("score");
  const [feed, setFeed] = useState<FeedState>({ status: "loading" });
  const [lists, setLists] = useState<Record<string, ListState>>({});
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const [importedNow, setImportedNow] = useState<Set<string>>(() => new Set());
  const [categories, setCategories] = useState<{ status: "loading" | "error" | "done"; list: CjCategory[] }>({
    status: "loading",
    list: [],
  });
  const [openItem, setOpenItem] = useState<WinningProduct | null>(null);
  const [detailCache] = useState(() => new Map<string, CjProductDetail>());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closeModal = useCallback(() => setOpenItem(null), []);

  const [niche, setNiche] = useState<string>(NICHES[0].name);

  // Saved filters live in localStorage, which only exists after mount.
  useEffect(() => {
    setFilters(loadFilters()); // eslint-disable-line react-hooks/set-state-in-effect
    setNiche(loadNiche());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/source/categories")
      .then((res) => res.json())
      .then((body) => {
        if (!cancelled) setCategories(body?.ok ? { status: "done", list: body.categories } : { status: "error", list: [] });
      })
      .catch(() => !cancelled && setCategories({ status: "error", list: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Only the latest request may update the feed (a category takes ~10 s, so
  // an earlier Apply can finish after a later one).
  const requestId = useRef(0);
  const load = useCallback(async (current: Filters) => {
    const id = ++requestId.current;
    setFeed({ status: "loading" });
    try {
      const res = await fetch(`/api/source/winning-products?${queryFor(current)}`);
      const body = await res.json().catch(() => null);
      if (id !== requestId.current) return;
      if (!res.ok || !body?.ok) {
        setFeed({ status: "error", message: body?.error ?? `Couldn't load products (HTTP ${res.status}).` });
        return;
      }
      setFeed({ status: "done", products: body.products });
    } catch {
      if (id === requestId.current) {
        setFeed({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
      }
    }
  }, []);

  useEffect(() => {
    if (filters) void load(filters); // eslint-disable-line react-hooks/set-state-in-effect
  }, [filters, load]);

  // Shares requestId with load(): whichever was started last fills the feed.
  async function suggest() {
    if (!filters) return;
    const id = ++requestId.current;
    const chosen = niche;
    saveNiche(chosen);
    setFeed({ status: "loading", suggesting: chosen });
    try {
      const params = new URLSearchParams(queryFor(filters));
      params.delete("category");
      params.delete("limit");
      params.set("niche", chosen);
      const res = await fetch(`/api/source/auto-suggest?${params}`);
      const body = await res.json().catch(() => null);
      if (id !== requestId.current) return;
      if (!res.ok || !body?.ok) {
        setFeed({ status: "error", suggesting: chosen, message: body?.error ?? `Couldn't find suggestions (HTTP ${res.status}).` });
        return;
      }
      setFeed({
        status: "done",
        products: body.products,
        suggestion: {
          niche: body.niche,
          keywords: body.keywords,
          keywordSource: body.keywordSource,
          searches: body.searches,
          pooled: body.pooled ?? body.products.length,
          hiddenByFilters: body.hiddenByFilters ?? 0,
        },
      });
    } catch {
      if (id === requestId.current) {
        setFeed({ status: "error", suggesting: chosen, message: "Couldn't reach AutoPilot. Check your connection and try again." });
      }
    }
  }

  const suggesting = feed.status === "done" ? feed.suggestion?.niche : feed.suggesting;

  function apply(next: Filters) {
    saveFilters(next);
    setFilters(next);
    setFiltersOpen(false);
  }

  const products = useMemo(() => (feed.status === "done" ? sortProducts(feed.products, sort) : []), [feed, sort]);

  async function autoList(product: WinningProduct) {
    const ok = window.confirm(
      `List "${product.title}" on eBay now?\n\nAutoPilot imports it from CJ and publishes it to your eBay store with your Settings (pricing, quantity, policies).`,
    );
    if (!ok) return;
    setLists((prev) => ({ ...prev, [product.pid]: { status: "working" } }));
    try {
      const res = await fetch("/api/source/auto-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid: product.pid }),
      });
      const body = await res.json().catch(() => null);
      if (body?.imported || body?.ok) setImportedNow((prev) => new Set(prev).add(product.pid));
      setLists((prev) => ({
        ...prev,
        [product.pid]:
          res.ok && body?.ok
            ? { status: "done", itemId: body.itemId, itemUrl: body.itemUrl, listPrice: body.listPrice }
            : {
                status: "error",
                message: body?.error ?? `Couldn't list it (HTTP ${res.status}).`,
                notConnected: body?.code === "not_connected",
              },
      }));
    } catch {
      setLists((prev) => ({ ...prev, [product.pid]: { status: "error", message: "Couldn't reach AutoPilot. Try again." } }));
    }
  }

  async function addToCatalog(pid: string) {
    setAdds((prev) => ({ ...prev, [pid]: "adding" }));
    try {
      const res = await fetch("/api/source/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.ok) {
        setImportedNow((prev) => new Set(prev).add(pid));
        setAdds((prev) => ({ ...prev, [pid]: "added" }));
      } else {
        setAdds((prev) => ({ ...prev, [pid]: { error: body?.error ?? `Couldn't add it (HTTP ${res.status}).` } }));
      }
    } catch {
      setAdds((prev) => ({ ...prev, [pid]: { error: "Couldn't reach AutoPilot. Try again." } }));
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <NichePanel
          niche={niche}
          onNiche={setNiche}
          onSuggest={() => void suggest()}
          busy={feed.status === "loading" && Boolean(feed.suggesting)}
        />
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className="mb-3 w-full rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 lg:hidden"
        >
          {filtersOpen ? "Hide filters" : "Filters"}
        </button>
        <div className={filtersOpen ? "block" : "hidden lg:block"}>
          {filters ? (
            <FiltersPanel
              key={JSON.stringify(filters)}
              value={filters}
              categories={categories}
              onApply={apply}
              onReset={() => apply(DEFAULT_FILTERS)}
            />
          ) : null}
        </div>
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-400" aria-live="polite">
            {feed.status === "done"
              ? feed.suggestion
                ? `${products.length} suggested winner${products.length === 1 ? "" : "s"} for ${feed.suggestion.niche}, ranked from CJ data`
                : `${products.length} product${products.length === 1 ? "" : "s"}, ranked from CJ data`
              : feed.status === "loading"
                ? feed.suggesting
                  ? `Asking Claude for ${feed.suggesting} keywords and searching CJ for each (about 20–40 seconds)…`
                  : "Scoring CJ products…"
                : ""}
          </p>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-lg border border-white/15 bg-navy-900 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-500"
            >
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {feed.status === "done" && feed.suggestion ? (
          <div className="ap-card space-y-2 rounded-2xl p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-400">
                {feed.suggestion.keywordSource === "claude" ? "Claude's keywords:" : "Keywords:"}
              </span>
              {feed.suggestion.searches.map((s) => (
                <span
                  key={s.keyword}
                  title={
                    s.error
                      ? `CJ search failed: ${s.error}`
                      : `${s.found} CJ result${s.found === 1 ? "" : "s"}${
                          s.broadenedTo ? ` (few exact matches, so "${s.broadenedTo}" was searched too)` : ""
                        }`
                  }
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    s.error ? "border-red-400/40 text-red-300" : "border-white/15 text-slate-200"
                  }`}
                >
                  {s.keyword}
                  {s.broadenedTo ? <span className="text-slate-500"> + {s.broadenedTo}</span> : null}{" "}
                  <span className="text-slate-500">· {s.error ? "failed" : s.found}</span>
                </span>
              ))}
              <button
                type="button"
                onClick={() => filters && void load(filters)}
                className="ml-auto text-xs font-semibold text-brand-400 hover:text-brand-500"
              >
                Back to feed
              </button>
            </div>
            {feed.suggestion.keywordSource === "fallback" ? (
              <p className="text-xs text-amber-200">
                Claude wasn&apos;t available, so these are AutoPilot&apos;s standard keywords for this niche.
              </p>
            ) : null}
            {feed.suggestion.hiddenByFilters > 0 ? (
              <p className="text-xs text-slate-400">
                Found {feed.suggestion.pooled} unique CJ products; your filters (minimum profit, maximum sellers, US
                warehouse) hid {feed.suggestion.hiddenByFilters}. Loosen them in Filters to see more.
              </p>
            ) : null}
          </div>
        ) : null}

        {feed.status === "loading" ? (
          <div className={GRID} aria-busy="true" aria-label="Loading products">
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} className="rounded-xl border border-white/10 bg-white/[0.03] p-2">
                <div className="aspect-square animate-pulse rounded-lg bg-white/5" />
                <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-white/5" />
                <div className="mt-2 h-4 w-1/3 animate-pulse rounded bg-white/5" />
              </div>
            ))}
          </div>
        ) : feed.status === "error" ? (
          <div className="ap-card rounded-2xl p-6 text-sm text-slate-300">
            <p>{feed.message}</p>
            {filters ? (
              <button
                type="button"
                onClick={() => void (feed.suggesting ? suggest() : load(filters))}
                className="mt-2 font-semibold text-brand-400 hover:text-brand-500"
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : products.length === 0 ? (
          <p className="ap-card rounded-2xl p-10 text-center text-sm text-slate-400">
            {suggesting
              ? "No products found for these keywords. Try another niche, or loosen the filters (US warehouse, maximum sellers, minimum profit)."
              : filters?.category
                ? "No products found for this category. Try a different category or turn off the US warehouse filter."
                : "No CJ products match these filters. Try a higher maximum sellers, a lower minimum profit, or another category."}
          </p>
        ) : (
          <div className={GRID}>
            {products.map((product) => {
              const list = lists[product.pid];
              const imported = product.imported || importedNow.has(product.pid);
              return (
                <div
                  key={product.pid}
                  className="group flex flex-col rounded-xl border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenItem(product)}
                      aria-label={`View details: ${product.title}`}
                      className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      <ProductImage src={product.imageUrl} />
                    </button>
                    <OriginDot origin={product.origin} />
                    <ScoreBadge product={product} />
                    {imported ? (
                      <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-lime-brand">
                        In catalog
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col px-0.5 pb-0.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpenItem(product)}
                      title={product.title}
                      className="block w-full truncate text-left text-xs text-slate-300 hover:text-white"
                    >
                      {product.title}
                    </button>
                    <p className="mt-1 text-sm leading-tight text-white">
                      <span className="font-bold">{money(product.price)}</span>
                      <span className="text-slate-400"> → {money(product.suggestedPrice)}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-lime-brand">
                      +{money(product.profit)} profit · {pct(product.margin)}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {product.listedNum.toLocaleString()} {product.listedNum === 1 ? "seller" : "sellers"} · {product.competition}{" "}
                      competition
                    </p>

                    <div className="mt-auto pt-2">
                      {list?.status === "done" ? (
                        <div className="rounded-lg border border-lime-brand/30 bg-lime-brand/10 px-2 py-1.5 text-[11px] text-lime-brand">
                          Listed on eBay ✓ at {money(list.listPrice)}
                          <a
                            href={list.itemUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-0.5 block truncate font-mono font-semibold underline"
                          >
                            #{list.itemId}
                          </a>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void autoList(product)}
                            disabled={list?.status === "working"}
                            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-lime-brand px-3 py-2 text-xs font-bold text-navy-950 hover:brightness-110 disabled:opacity-70"
                          >
                            {list?.status === "working" ? (
                              <>
                                <span
                                  className="h-3 w-3 animate-spin rounded-full border-2 border-navy-950/30 border-t-navy-950"
                                  aria-hidden="true"
                                />
                                Listing…
                              </>
                            ) : (
                              <>
                                <span className="sm:hidden">Auto-list</span>
                                <span className="hidden sm:inline">Auto-list this product</span>
                              </>
                            )}
                          </button>
                          {list?.status === "error" ? (
                            <p className="mt-1 text-[11px] leading-snug text-red-300" role="alert">
                              {list.message}
                              {list.notConnected ? (
                                <>
                                  {" "}
                                  <Link href="/dashboard/settings" className="underline">
                                    Settings
                                  </Link>
                                </>
                              ) : null}
                            </p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {openItem ? (
        <SourceProductModal
          item={openItem}
          addState={adds[openItem.pid]}
          imported={openItem.imported || importedNow.has(openItem.pid)}
          onAdd={(pid) => void addToCatalog(pid)}
          onClose={closeModal}
          cache={detailCache}
        />
      ) : null}
    </div>
  );
}
