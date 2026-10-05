"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

export type BulkProduct = {
  externalId: string;
  title: string;
  category: string;
  supplierPrice: number;
  suggestedPrice: number;
  netProfit: number;
  variants: number;
  veroRisk: "low" | "medium" | "high";
  veroReason: string;
};

type Props = {
  products: BulkProduct[];
  batchSize: number;
  activeListings: number;
  activeUsed: number;
  planName: string;
  isTrial: boolean;
};

type BulkResponse = {
  ok: boolean;
  code?: string;
  error?: string;
  upgrade?: boolean;
  upgradePlan?: string | null;
  limitType?: string;
  requested?: number;
  published?: number;
  blocked?: number;
  variantTotal?: number;
  results?: { title: string; status: string; variants: number; message?: string }[];
};

export function BulkLister({ products, batchSize, activeListings, activeUsed, planName, isTrial }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<BulkResponse | null>(null);

  const visible = useMemo(
    () => (query ? products.filter((p) => p.title.toLowerCase().includes(query.toLowerCase())) : products),
    [products, query],
  );

  const chosen = products.filter((p) => selected.has(p.externalId));
  const projectedProfit = chosen.reduce((sum, p) => sum + p.netProfit, 0);
  const projectedVariants = chosen.reduce((sum, p) => sum + p.variants, 0);
  const remaining = Math.max(0, activeListings - activeUsed);
  const perRunCap = Math.min(batchSize, remaining);
  const overLimit = selected.size > perRunCap;
  const atCapacity = remaining === 0;

  const blockedIds = useMemo(
    () => new Set(products.filter((p) => p.veroRisk === "high").map((p) => p.externalId)),
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
          .filter((p) => p.veroRisk !== "high")
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
        body: JSON.stringify({ externalIds: Array.from(selected) }),
      });
      const json = (await res.json()) as BulkResponse;
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
            Select {Math.min(visible.filter((p) => p.veroRisk !== "high").length, perRunCap)}
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
            {busy ? `Listing ${selected.size}…` : `⚡ List selected (${selected.size})`}
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

      {summary ? (
        summary.ok ? (
          <div className="rounded-2xl border border-lime-brand/30 bg-lime-brand/10 px-4 py-3 text-sm text-lime-brand">
            <p>
              Batch complete: {summary.published}/{summary.requested} listings pushed, {summary.variantTotal} variant
              rows built. Open the Listings tab to review them.
            </p>
            {summary.blocked ? (
              <ul className="mt-2 space-y-1 text-amber-200">
                {summary.results
                  ?.filter((row) => row.status === "blocked")
                  .map((row) => (
                    <li key={row.title}>
                      ⛔ {row.title}: {row.message}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4 text-sm text-amber-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <p className="font-semibold text-amber-100 flex items-center gap-1.5">
                  <span>⚠️</span> {summary.code === "plan_limit_reached" ? "Plan Limit Reached" : "Batch could not be listed"}
                </p>
                <p className="mt-1 text-slate-300">{summary.error}</p>
              </div>
              {(summary.upgrade || summary.code === "plan_limit_reached") && (
                <Link
                  href="/dashboard/billing"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-brand-500 px-5 py-2 text-xs font-bold text-white transition hover:bg-brand-400 shadow-md"
                >
                  <span>Upgrade to {summary.upgradePlan ?? "Pro"}</span>
                  <span>→</span>
                </Link>
              )}
            </div>
          </div>
        )
      ) : null}

      <div className="ap-card overflow-x-auto rounded-2xl">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-white/10 text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
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
              const isBlocked = product.veroRisk === "high";
              return (
                <tr
                  key={product.externalId}
                  onClick={() => toggle(product.externalId)}
                  title={isBlocked || product.veroRisk === "medium" ? product.veroReason : undefined}
                  className={`border-b border-white/5 last:border-0 ${
                    isBlocked
                      ? "cursor-not-allowed opacity-50"
                      : isOn
                        ? "cursor-pointer bg-brand-500/10"
                        : "cursor-pointer hover:bg-white/[0.03]"
                  }`}
                >
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
                    <span className="block text-[11px] text-slate-500">
                      {product.category}
                      {isBlocked ? (
                        <span className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 font-semibold text-red-300">
                          Brand blocked
                        </span>
                      ) : product.veroRisk === "medium" ? (
                        <span className="ml-2 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-200">
                          Brand mentioned
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-slate-300">${product.supplierPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-white">${product.suggestedPrice.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-lime-brand">${product.netProfit.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-slate-300">{product.variants}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
