"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  applySourceFilters,
  activeFilterChips,
  EMPTY_FILTERS,
  loadSavedFilters,
  parseLimit,
  saveFilters,
  SourceFilterChips,
  SourceFilterPanel,
  type SourceFilterValues,
} from "@/components/dashboard/SourceFilters";
import {
  type AddState,
  BoxIcon,
  SourceProductModal,
  type SourceModalItem,
} from "@/components/dashboard/SourceProductModal";
import type { CjCategory, CjProductDetail } from "@/lib/cj/catalog";

type SearchItem = {
  pid: string;
  title: string;
  imageUrl: string | null;
  price: number;
  priceLabel: string;
  listedNum: number;
  category: string;
  origin: "US" | "CN" | null;
  imported: boolean;
};

type SearchState =
  | { status: "idle" }
  | { status: "loading"; query: string; page: number }
  | { status: "error"; message: string }
  | {
      status: "done";
      query: string;
      page: number;
      pageSize: number;
      total: number;
      items: SearchItem[];
      /** Results CJ returned that the relevance filter hid. */
      rejected: number;
    };

type CategoryState = { status: "idle" | "loading" | "error" | "done"; list: CjCategory[] };

const money = (n: number) => `$${n.toFixed(2)}`;

/** Square product photo; a box icon replaces it when there is no URL or it fails to load. */
function ProductImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg bg-white/5 text-slate-500">
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <BoxIcon className="h-8 w-8" />
      )}
    </div>
  );
}

const GRID = "grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5";

/** Origin as a dot in the image corner: green for CJ's US warehouse, grey for China. */
function OriginDot({ origin }: { origin: SearchItem["origin"] }) {
  if (!origin) return null;
  const label = origin === "US" ? "Ships from US warehouse" : "Ships from China";
  return (
    <span
      title={label}
      className={`absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-navy-950/80 ${
        origin === "US" ? "bg-lime-brand" : "bg-slate-400"
      }`}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} className={className} aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Circular add button over the image. Hidden until the card is hovered on
 * devices that can hover; always shown on touch screens, while adding, and once added.
 */
function AddIconButton({ state, onAdd, title }: { state: AddState | undefined; onAdd: () => void; title: string }) {
  const added = state === "added";
  const adding = state === "adding";
  const error = typeof state === "object" ? state.error : null;
  const label = added ? `Added: ${title}` : error ? `Couldn't add (${error}) — try again` : `Add to my catalog: ${title}`;
  const tone = added
    ? "bg-lime-brand text-navy-950"
    : error
      ? "bg-red-500 text-white hover:bg-red-400"
      : "bg-brand-500 text-white hover:bg-brand-400";
  const visibility =
    added || adding || error
      ? "opacity-100"
      : "opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-visible:opacity-100";
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={added || adding}
      title={label}
      aria-label={label}
      className={`absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-full shadow-lg shadow-black/40 transition-opacity duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default ${tone} ${visibility}`}
    >
      {added ? (
        <CheckIcon className="h-4 w-4" />
      ) : adding ? (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />
      ) : error ? (
        <span className="text-sm font-bold" aria-hidden="true">!</span>
      ) : (
        <PlusIcon className="h-4 w-4" />
      )}
    </button>
  );
}

export function SourceSearch() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [adds, setAdds] = useState<Record<string, AddState>>({});
  const [openItem, setOpenItem] = useState<(SourceModalItem & { imported: boolean }) | null>(null);
  // One Map for the page's lifetime: reopening a product doesn't call CJ again.
  const [detailCache] = useState(() => new Map<string, CjProductDetail>());
  const closeModal = useCallback(() => setOpenItem(null), []);
  const [filters, setFilters] = useState<SourceFilterValues>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryState>({ status: "idle", list: [] });

  // Restore the last used filters after mount (localStorage isn't available during server render).
  useEffect(() => {
    setFilters(loadSavedFilters());
  }, []);

  function updateFilters(patch: Partial<SourceFilterValues>) {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      saveFilters(next);
      return next;
    });
  }

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
    saveFilters(EMPTY_FILTERS);
  }

  const loadCategories = useCallback(async () => {
    setCategories((prev) => ({ ...prev, status: "loading" }));
    try {
      const res = await fetch("/api/source/categories");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error();
      setCategories({ status: "done", list: body.categories });
    } catch {
      setCategories((prev) => ({ ...prev, status: "error" }));
    }
  }, []);

  // Categories load once: when the panel first opens, or when a saved category needs its names.
  useEffect(() => {
    if (categories.status === "idle" && (filtersOpen || filters.category)) void loadCategories();
  }, [categories.status, filtersOpen, filters.category, loadCategories]);

  const chipCount = activeFilterChips(filters).length;
  const visibleItems = useMemo(
    () => (state.status === "done" ? applySourceFilters(state.items, filters, categories.list) : []),
    [state, filters, categories.list],
  );

  async function search(q: string, page: number) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setState({ status: "loading", query: trimmed, page });
    try {
      const params = new URLSearchParams({ q: trimmed, page: String(page) });
      // Price and seller limits also narrow what CJ returns; everything is re-checked locally too.
      const limits = { minPrice: filters.minPrice, maxPrice: filters.maxPrice, minSellers: filters.minSellers, maxSellers: filters.maxSellers };
      for (const [key, value] of Object.entries(limits)) {
        const n = parseLimit(value);
        if (n != null) params.set(key, String(n));
      }
      const res = await fetch(`/api/source/search?${params}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setState({ status: "error", message: body?.error ?? `Search failed (HTTP ${res.status}).` });
        return;
      }
      setState({
        status: "done",
        query: trimmed,
        page: body.page,
        pageSize: body.pageSize,
        total: body.total,
        items: body.items,
        rejected: body.rejected ?? 0,
      });
    } catch {
      setState({ status: "error", message: "Couldn't reach AutoPilot. Check your connection and try again." });
    }
  }

  async function add(pid: string) {
    setAdds((prev) => ({ ...prev, [pid]: "adding" }));
    try {
      const res = await fetch("/api/source/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid }),
      });
      const body = await res.json().catch(() => null);
      setAdds((prev) => ({
        ...prev,
        [pid]: res.ok && body?.ok ? "added" : { error: body?.error ?? `Couldn't add it (HTTP ${res.status}).` },
      }));
    } catch {
      setAdds((prev) => ({ ...prev, [pid]: { error: "Couldn't reach AutoPilot. Try again." } }));
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void search(query, 1);
  }

  const loading = state.status === "loading";
  const lastPage = state.status === "done" ? Math.max(1, Math.ceil(state.total / state.pageSize)) : 1;

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="source-q" className="sr-only">
          Search CJ products
        </label>
        <input
          id="source-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search CJ products, e.g. phone holder, yoga mat"
          maxLength={100}
          className="min-w-[180px] flex-1 rounded-xl border border-white/15 bg-navy-900 px-3 py-2 text-sm text-white outline-none focus:border-brand-500"
        />
        <button
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          aria-controls="source-filters"
          className={`inline-flex items-center justify-center gap-1.5 rounded-full border px-4 py-2.5 text-sm font-medium ${
            filtersOpen || chipCount ? "border-brand-500/60 bg-brand-500/10 text-white" : "border-white/20 text-slate-200 hover:bg-white/5"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
          </svg>
          Filters
          {chipCount ? (
            <span className="rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold leading-5 text-white">{chipCount}</span>
          ) : null}
        </button>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {filtersOpen ? (
        <SourceFilterPanel
          filters={filters}
          onChange={updateFilters}
          onClear={clearFilters}
          categories={categories}
          onRetryCategories={() => void loadCategories()}
        />
      ) : null}
      <SourceFilterChips filters={filters} onChange={updateFilters} onClear={clearFilters} />

      {state.status === "idle" ? (
        <div className="ap-card rounded-2xl p-6 text-sm text-slate-400">
          Search for a product type to see what CJ Dropshipping can supply, with its price, how many sellers already
          list it, and whether it ships from a US warehouse.
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className={GRID} aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="animate-pulse space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-2">
              <div className="aspect-square w-full rounded-lg bg-white/5" />
              <div className="h-3 w-5/6 rounded bg-white/5" />
              <div className="h-4 w-1/3 rounded bg-white/5" />
              <div className="h-2.5 w-1/4 rounded bg-white/5" />
            </div>
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-200">
          <span>{state.message}</span>
          {query.trim() ? (
            <button
              type="button"
              onClick={() => void search(query, 1)}
              className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/5"
            >
              Try again
            </button>
          ) : null}
        </div>
      ) : null}

      {state.status === "done" && state.items.length === 0 ? (
        <div className="ap-card rounded-2xl p-6 text-sm text-slate-400">
          No CJ products match <span className="text-white">&ldquo;{state.query}&rdquo;</span>
          {state.rejected ? ` (CJ returned ${state.rejected} unrelated results, hidden)` : ""}. Try a broader or different
          keyword.
        </div>
      ) : null}

      {state.status === "done" && state.items.length > 0 && visibleItems.length === 0 ? (
        <div className="ap-card flex flex-wrap items-center justify-between gap-2 rounded-2xl p-6 text-sm text-slate-400">
          <span>No products match. Try removing a filter.</span>
          <button type="button" onClick={clearFilters} className="font-semibold text-brand-400 hover:text-brand-500">
            Clear all filters
          </button>
        </div>
      ) : null}

      {state.status === "done" && visibleItems.length > 0 ? (
        <>
          <p className="text-xs text-slate-400">
            {chipCount ? (
              <>
                <span className="text-white">{visibleItems.length}</span> {visibleItems.length === 1 ? "result" : "results"} after
                filtering (of {state.items.length} on this page)
              </>
            ) : (
              <>
                {state.total.toLocaleString()} results for <span className="text-white">&ldquo;{state.query}&rdquo;</span>
              </>
            )}
            {state.rejected ? ` · ${state.rejected} unrelated ${state.rejected === 1 ? "result" : "results"} hidden` : null}
            {lastPage > 1 ? ` · page ${state.page} of ${lastPage}` : null}
          </p>
          <div className={GRID}>
            {visibleItems.map((item) => {
              const addState: AddState | undefined = item.imported ? "added" : adds[item.pid];
              const error = typeof addState === "object" ? addState.error : null;
              return (
                <div
                  key={item.pid}
                  className="group rounded-xl border border-white/10 bg-white/[0.03] p-2 transition-colors hover:border-white/20 hover:bg-white/[0.07]"
                >
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenItem(item)}
                      aria-label={`View details: ${item.title}`}
                      className="block w-full rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                    >
                      <ProductImage src={item.imageUrl} />
                    </button>
                    <OriginDot origin={item.origin} />
                    <AddIconButton state={addState} title={item.title} onAdd={() => void add(item.pid)} />
                  </div>
                  <div className="px-0.5 pb-0.5 pt-2">
                    <button
                      type="button"
                      onClick={() => setOpenItem(item)}
                      title={item.title}
                      className="block w-full truncate text-left text-xs text-slate-300 hover:text-white"
                    >
                      {item.title}
                    </button>
                    <p
                      className="mt-1 text-base font-bold leading-tight text-white"
                      title={item.priceLabel ? `CJ price: ${item.priceLabel}` : undefined}
                    >
                      {item.price > 0 ? money(item.price) : "—"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-400">
                      {item.listedNum.toLocaleString()} {item.listedNum === 1 ? "seller" : "sellers"}
                    </p>
                    {error ? (
                      <p className="mt-1 truncate text-[11px] text-red-300" title={error}>
                        {error}
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {lastPage > 1 ? (
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void search(state.query, state.page - 1)}
                disabled={state.page <= 1}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                onClick={() => void search(state.query, state.page + 1)}
                disabled={state.page >= Math.min(lastPage, 50)}
                className="rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/5 disabled:opacity-40"
              >
                Next →
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {openItem ? (
        <SourceProductModal
          item={openItem}
          addState={openItem.imported ? "added" : adds[openItem.pid]}
          onAdd={(pid) => void add(pid)}
          onClose={closeModal}
          cache={detailCache}
        />
      ) : null}
    </div>
  );
}
