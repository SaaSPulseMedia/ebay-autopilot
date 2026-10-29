"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { cjProductUrl } from "@/lib/cj/urls";
import { demandLabel } from "@/lib/demand-labels";

export type ReadyProduct = {
  pid: string;
  niche: string;
  title: string;
  imageUrl: string | null;
  cost: number;
  shipping: number;
  listPrice: number;
  profit: number;
  market: number | null;
  variantCount: number;
  ebayCategory: string | null;
  ebaySold: number | null;
  ebayListings: number | null;
  checkedAt: string | null;
};

const money = (n: number) => `$${n.toFixed(2)}`;

type ListResult = { ok: true; itemUrl: string; listPrice: number; message?: string } | { ok: false; error: string };

/** One ready product: its numbers, "List on eBay" (imports it and publishes it now) and "Not for me". */
export function ReadyCard({ product: p, ebayConnected }: { product: ReadyProduct; ebayConnected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"list" | "dismiss" | null>(null);
  const [result, setResult] = useState<ListResult | null>(null);
  const [gone, setGone] = useState(false);

  async function list() {
    setBusy("list");
    setResult(null);
    try {
      const res = await fetch("/api/source/auto-list", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid: p.pid }),
      });
      setResult((await res.json()) as ListResult);
    } catch {
      setResult({ ok: false, error: "The listing didn't finish. Check your Listings page before trying again." });
    } finally {
      setBusy(null);
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    try {
      const res = await fetch("/api/sourcing/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pid: p.pid }),
      });
      if (res.ok) {
        setGone(true);
        router.refresh();
      }
    } finally {
      setBusy(null);
    }
  }

  if (gone) return null;
  return (
    <article className="ap-card flex min-w-0 flex-col gap-3 rounded-2xl p-3">
      <div className="flex min-w-0 gap-3">
        {p.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.imageUrl} alt="" className="h-20 w-20 flex-none rounded-xl object-cover" />
        ) : (
          <div className="h-20 w-20 flex-none rounded-xl bg-white/5" />
        )}
        <div className="min-w-0 flex-1 space-y-1 text-xs">
          <p className="line-clamp-2 text-sm text-white">{p.title}</p>
          <p className="text-slate-400">
            List at <span className="text-white">{money(p.listPrice)}</span> · profit{" "}
            <span className="font-semibold text-lime-brand">{money(p.profit)}</span>
          </p>
          <p className="text-slate-500">
            CJ {money(p.cost)} + shipping {p.shipping === 0 ? "free" : money(p.shipping)}
            {p.market != null ? ` · eBay avg ${money(p.market)}` : ""}
            {p.variantCount > 1 ? ` · ${p.variantCount} variants` : ""}
          </p>
          <DemandLine sold={p.ebaySold} listings={p.ebayListings} />
          <p className="truncate text-slate-500">
            {p.niche}
            {p.ebayCategory ? ` → ${p.ebayCategory}` : ""}
          </p>
          <a href={cjProductUrl(p.pid, p.title)} target="_blank" rel="noreferrer" className="inline-block text-brand-400 hover:underline">
            View on CJ
          </a>
        </div>
      </div>

      {result?.ok ? (
        <p className="rounded-xl border border-lime-brand/30 bg-lime-brand/10 px-3 py-2 text-xs text-lime-brand">
          Listed on eBay at {money(result.listPrice)}.{" "}
          <a href={result.itemUrl} target="_blank" rel="noreferrer" className="underline">
            See it on eBay
          </a>
        </p>
      ) : (
        <>
          {result && !result.ok ? <p className="text-xs text-red-300">{result.error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={list}
              disabled={busy !== null || !ebayConnected}
              title={ebayConnected ? undefined : "Connect your eBay store in Settings first."}
              className="flex-1 rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            >
              {busy === "list" ? "Listing… (up to a minute)" : "List on eBay"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={busy !== null}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            >
              {busy === "dismiss" ? "…" : "Not for me"}
            </button>
          </div>
        </>
      )}
    </article>
  );
}

/** "Selling well on eBay (top listings sold 340) · few competitors (210 listings)". */
function DemandLine({ sold, listings }: { sold: number | null; listings: number | null }) {
  const { wanted, crowd, tone } = demandLabel(sold, listings);
  if (!wanted && !crowd) return <p className="text-slate-500">eBay demand: checked at the next re-check</p>;
  const color = tone === "good" ? "text-lime-brand" : tone === "weak" ? "text-amber-200" : "text-slate-300";
  return (
    <p className={color}>
      {wanted ? `${wanted} (top listings sold ${sold?.toLocaleString("en-US")})` : "eBay sales unknown"}
      {crowd ? ` · ${crowd} (${listings?.toLocaleString("en-US")} listings)` : ""}
    </p>
  );
}
