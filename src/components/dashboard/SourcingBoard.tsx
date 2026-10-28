"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { MoreLikeThis } from "@/components/dashboard/MoreLikeThis";
import { cjProductUrl } from "@/lib/cj/urls";
import { demandLabel } from "@/lib/demand-labels";
import { MIN_PROFIT_LABEL } from "@/lib/pricing";
import { REJECT_REASONS, type RejectReason } from "@/lib/sourcing-reasons";

type ReadyProduct = {
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

type TurnedDownProduct = {
  pid: string;
  title: string;
  imageUrl: string | null;
  reason: RejectReason;
  detail: string;
  checkedAt: string | null;
};

type Counts = { checked: number; ready: number; rejected: Partial<Record<RejectReason, number>> };

type RunResult =
  | {
      ok: true;
      found: number;
      checked: number;
      ready: number;
      rejected: Partial<Record<RejectReason, number>>;
      errors: number;
      ebayChecksSkipped: boolean;
    }
  | { ok: false; error: string };

type Props = {
  niches: string[];
  selected: string[];
  enabled: boolean;
  lastRunAt: string | null;
  waiting: number;
  last24h: Counts;
  ready: ReadyProduct[];
  turnedDown: TurnedDownProduct[];
  ebayConnected: boolean;
};

const money = (n: number) => `$${n.toFixed(2)}`;

function ago(iso: string | null) {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}

/** "12 too expensive vs eBay · 3 under $3.00 profit", largest first. */
function reasonsLine(rejected: Partial<Record<RejectReason, number>>) {
  return (Object.entries(rejected) as Array<[RejectReason, number]>)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, n]) => `${n} ${REJECT_REASONS[reason]}`)
    .join(" · ");
}

export function SourcingBoard({ niches, selected, enabled, lastRunAt, waiting, last24h, ready, turnedDown, ebayConnected }: Props) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(selected);
  const [auto, setAuto] = useState(enabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<RunResult | null>(null);

  const dirty = auto !== enabled || picked.length !== selected.length || picked.some((n) => !selected.includes(n));

  function toggle(name: string) {
    setSaved(null);
    setPicked((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));
  }

  async function save() {
    setSaving(true);
    setSaved(null);
    try {
      const res = await fetch("/api/sourcing/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ niches: picked, enabled: auto }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      setSaved(json.ok ? "Saved." : (json.error ?? "Couldn't save. Try again."));
      if (json.ok) router.refresh();
    } catch {
      setSaved("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function checkNow() {
    setRunning(true);
    setRun(null);
    try {
      const res = await fetch("/api/sourcing/run", { method: "POST" });
      setRun((await res.json()) as RunResult);
      router.refresh();
    } catch {
      setRun({ ok: false, error: "The check didn't finish. Try again in a minute." });
    } finally {
      setRunning(false);
    }
  }

  const rejectedTotal = last24h.checked - last24h.ready;

  return (
    <div className="space-y-5">
      <section className="ap-card space-y-4 rounded-2xl p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Your niches</h2>
          <p className="mt-0.5 text-xs text-slate-400">AutoPilot looks for products in these. Pick one or more.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {niches.map((name) => {
            const on = picked.includes(name);
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                aria-pressed={on}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${
                  on ? "border-brand-500 bg-brand-500/20 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input type="checkbox" checked={auto} onChange={(e) => (setAuto(e.target.checked), setSaved(null))} className="h-4 w-4 accent-brand-500" />
          Check new products automatically every hour
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saved ? <span className="text-xs text-slate-300">{saved}</span> : null}
        </div>
      </section>

      <section className="ap-card space-y-3 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-300">
            Last check: <span className="text-white">{ago(lastRunAt)}</span> · {waiting} product{waiting === 1 ? "" : "s"} waiting to be
            checked
          </p>
          <button
            type="button"
            onClick={checkNow}
            disabled={running || !selected.length}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
          >
            {running ? "Checking… (up to a minute)" : "Check now"}
          </button>
        </div>
        {!selected.length ? <p className="text-xs text-amber-200">Pick and save at least one niche to start.</p> : null}
        {!ebayConnected ? (
          <p className="text-xs text-amber-200">
            Your eBay store isn&apos;t connected, so eBay&apos;s category, variant and size checks are skipped. Connect it in
            Settings for products that are fully checked.
          </p>
        ) : null}
        {run ? (
          run.ok && run.checked === 0 && run.errors === 0 ? (
            <p className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-slate-200">
              No new products in your niches this time: everything AutoPilot found has been checked already. The next
              check looks in other CJ categories, or add another niche.
            </p>
          ) : run.ok ? (
            <p className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-xs text-slate-200">
              {run.found ? `Found ${run.found} new product${run.found === 1 ? "" : "s"}. ` : ""}
              Checked {run.checked}: <span className="text-lime-brand">{run.ready} ready</span>
              {run.checked - run.ready > 0 ? `, ${run.checked - run.ready} turned down (${reasonsLine(run.rejected)})` : ""}.
              {run.errors ? ` ${run.errors} couldn't be checked right now (CJ didn't answer) and will be retried.` : ""}
            </p>
          ) : (
            <p className="text-xs text-red-300">{run.error}</p>
          )
        ) : null}
        <p className="text-sm text-slate-300">
          Last 24 hours: checked <span className="text-white">{last24h.checked}</span> →{" "}
          <span className="font-semibold text-lime-brand">{last24h.ready} ready</span>
          {rejectedTotal > 0 ? <span className="text-slate-400"> · {reasonsLine(last24h.rejected)}</span> : null}
        </p>
      </section>

      <MoreLikeThis />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Ready to list ({ready.length})</h2>
          <p className="mt-0.5 text-xs text-slate-400">Most wanted on eBay first: what similar listings have sold, with fewer competitors counting for more.</p>
        </div>
        {ready.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ready.map((p) => (
              <ReadyCard key={p.pid} product={p} ebayConnected={ebayConnected} />
            ))}
          </div>
        ) : (
          <p className="ap-card rounded-2xl p-8 text-center text-sm text-slate-400">
            Nothing ready yet. Products appear here once they pass every check: real CJ shipping, at least {`${MIN_PROFIT_LABEL} profit, `}a price
            eBay buyers pay, no brand risk, and eBay&apos;s category and size rules.
          </p>
        )}
      </section>

      {turnedDown.length ? (
        <details className="ap-card rounded-2xl p-4">
          <summary className="cursor-pointer text-sm text-slate-300">
            See the last {turnedDown.length} product{turnedDown.length === 1 ? "" : "s"} turned down, and why
          </summary>
          <ul className="mt-3 divide-y divide-white/8">
            {turnedDown.map((p) => (
              <li key={p.pid} className="flex min-w-0 gap-3 py-2.5 text-xs">
                {p.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.imageUrl} alt="" className="h-12 w-12 flex-none rounded-lg object-cover" />
                ) : (
                  <div className="h-12 w-12 flex-none rounded-lg bg-white/5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-200">{p.title || p.pid}</p>
                  <p className="text-amber-200">{REJECT_REASONS[p.reason] ?? p.reason}</p>
                  {p.detail ? <p className="text-slate-500">{p.detail}</p> : null}
                </div>
                <span className="flex-none text-slate-500">{ago(p.checkedAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

type ListResult = { ok: true; itemUrl: string; listPrice: number; message?: string } | { ok: false; error: string };

/** One ready product: its numbers, "List on eBay" (imports it and publishes it now) and "Not for me". */
function ReadyCard({ product: p, ebayConnected }: { product: ReadyProduct; ebayConnected: boolean }) {
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
