"use client";

import { type FormEvent, useCallback, useState } from "react";

import {
  type AddState,
  BoxIcon,
  OriginBadge,
  SourceProductModal,
  type SourceModalItem,
} from "@/components/dashboard/SourceProductModal";
import type { CjProductDetail } from "@/lib/cj/catalog";

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
  | { status: "done"; query: string; page: number; pageSize: number; total: number; items: SearchItem[] };

const money = (n: number) => `$${n.toFixed(2)}`;

/** Square product photo; a box icon replaces it when there is no URL or it fails to load. */
function ProductImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-white/5 text-slate-500">
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
        <BoxIcon className="h-10 w-10" />
      )}
    </div>
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

  async function search(q: string, page: number) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setState({ status: "loading", query: trimmed, page });
    try {
      const res = await fetch(`/api/source/search?q=${encodeURIComponent(trimmed)}&page=${page}`);
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        setState({ status: "error", message: body?.error ?? `Search failed (HTTP ${res.status}).` });
        return;
      }
      setState({ status: "done", query: trimmed, page: body.page, pageSize: body.pageSize, total: body.total, items: body.items });
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
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {state.status === "idle" ? (
        <div className="ap-card rounded-2xl p-6 text-sm text-slate-400">
          Search for a product type to see what CJ Dropshipping can supply, with its price, how many sellers already
          list it, and whether it ships from a US warehouse.
        </div>
      ) : null}

      {state.status === "loading" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading results">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="ap-card animate-pulse space-y-3 rounded-2xl p-4">
              <div className="aspect-square w-full rounded-xl bg-white/5" />
              <div className="h-4 w-3/4 rounded bg-white/5" />
              <div className="h-4 w-1/2 rounded bg-white/5" />
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
          No CJ products match <span className="text-white">&ldquo;{state.query}&rdquo;</span>. Try a broader or
          different keyword.
        </div>
      ) : null}

      {state.status === "done" && state.items.length > 0 ? (
        <>
          <p className="text-xs text-slate-400">
            {state.total.toLocaleString()} results for <span className="text-white">&ldquo;{state.query}&rdquo;</span>
            {lastPage > 1 ? ` · page ${state.page} of ${lastPage}` : null}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {state.items.map((item) => {
              const addState: AddState | undefined = item.imported ? "added" : adds[item.pid];
              const added = addState === "added";
              const adding = addState === "adding";
              const error = typeof addState === "object" ? addState.error : null;
              return (
                <div key={item.pid} className="ap-card flex flex-col gap-3 rounded-2xl p-4">
                  <button
                    type="button"
                    onClick={() => setOpenItem(item)}
                    aria-label={`View details: ${item.title}`}
                    className="block w-full rounded-xl transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500"
                  >
                    <ProductImage src={item.imageUrl} />
                  </button>
                  <div className="flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <OriginBadge origin={item.origin} />
                      {item.category ? <span className="text-[11px] text-slate-400">{item.category}</span> : null}
                    </div>
                    <h2 className="line-clamp-2 text-sm font-semibold text-white" title={item.title}>
                      <button
                        type="button"
                        onClick={() => setOpenItem(item)}
                        className="text-left hover:text-brand-400 hover:underline"
                      >
                        {item.title}
                      </button>
                    </h2>
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span>
                        <span className="text-xs text-slate-400">CJ price </span>
                        <span className="font-semibold text-white" title={item.priceLabel ? `CJ: ${item.priceLabel}` : undefined}>
                          {item.price > 0 ? money(item.price) : "—"}
                        </span>
                      </span>
                      <span className="text-xs text-slate-400" title="How many CJ sellers have listed this product">
                        {item.listedNum.toLocaleString()} {item.listedNum === 1 ? "seller" : "sellers"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void add(item.pid)}
                    disabled={added || adding}
                    className={
                      added
                        ? "rounded-full border border-lime-brand/30 bg-lime-brand/10 px-4 py-2 text-sm font-semibold text-lime-brand"
                        : "rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
                    }
                  >
                    {added ? "Added ✓" : adding ? "Adding…" : error ? "Try again" : "Add to my catalog"}
                  </button>
                  {error ? <p className="text-xs text-red-300">{error}</p> : null}
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
