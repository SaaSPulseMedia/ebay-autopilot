"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Synced = { id: number; title: string; ebayItemId: string | null; reason: string };
type SyncResponse = {
  ok: boolean;
  error?: string;
  checked?: number;
  ended?: number;
  still_active?: number;
  errors?: number;
  ended_listings?: Synced[];
  error_listings?: Synced[];
  next_after_id?: number;
  remaining?: number;
};
type Totals = { checked: number; ended: number; stillActive: number; endedList: Synced[]; errorList: Synced[] };

/** "Sync from eBay": marks listings eBay has ended as ended here. Runs page by page until done. */
export function SyncFromEbay() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sync() {
    setBusy(true);
    setError(null);
    setTotals(null);
    const sum: Totals = { checked: 0, ended: 0, stillActive: 0, endedList: [], errorList: [] };
    let afterId = 0;
    try {
      for (;;) {
        setProgress(sum.checked ? `Checked ${sum.checked} so far…` : "Checking your listings on eBay (about 1 per second)…");
        const res = await fetch(`/api/admin/sync-listings${afterId ? `?afterId=${afterId}` : ""}`, { method: "POST" });
        const data = (await res.json().catch(() => null)) as SyncResponse | null;
        if (!res.ok || !data?.ok) {
          setError(data?.error ?? "Sync failed. Try again in a moment.");
          break;
        }
        sum.checked += data.checked ?? 0;
        sum.ended += data.ended ?? 0;
        sum.stillActive += data.still_active ?? 0;
        sum.endedList.push(...(data.ended_listings ?? []));
        sum.errorList.push(...(data.error_listings ?? []));
        if (!data.next_after_id) break;
        afterId = data.next_after_id;
      }
      if (sum.checked || sum.ended) setTotals(sum);
      if (sum.ended) router.refresh();
    } catch {
      setError("Could not reach the server. Try again in a moment.");
      if (sum.checked) setTotals(sum);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} aria-hidden="true">
            <path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2M21 4v5h-5M3 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {busy ? "Syncing…" : "Sync from eBay"}
        </button>
        <p className="text-xs text-slate-500">Checks each active listing on eBay and marks the ones that have ended there as ended.</p>
      </div>
      {progress || error || totals ? (
        <div role="status" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
          {progress ? <p>{progress}</p> : null}
          {error ? <p className="text-red-300">{error}</p> : null}
          {totals ? (
            <>
              <p>
                Checked <span className="font-semibold text-white">{totals.checked}</span> active listing
                {totals.checked === 1 ? "" : "s"}: <span className="font-semibold text-lime-brand">{totals.stillActive} still live</span> on
                eBay, <span className="font-semibold text-amber-200">{totals.ended} marked ended</span>
                {totals.errorList.length ? (
                  <>
                    , <span className="font-semibold text-red-300">{totals.errorList.length} couldn&apos;t be checked</span> (left as
                    active)
                  </>
                ) : null}
                .
              </p>
              {totals.endedList.length || totals.errorList.length ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-200">Show details</summary>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
                    {totals.endedList.map((item) => (
                      <li key={`e${item.id}`} className="flex gap-2">
                        <span className="shrink-0 text-amber-200">Ended</span>
                        <span className="truncate text-slate-200">{item.title}</span>
                        <span className="shrink-0 text-slate-500">— {item.reason}</span>
                      </li>
                    ))}
                    {totals.errorList.map((item) => (
                      <li key={`x${item.id}`} className="flex gap-2">
                        <span className="shrink-0 text-red-300">Unchecked</span>
                        <span className="truncate text-slate-200">{item.title}</span>
                        <span className="shrink-0 text-slate-500">— {item.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
