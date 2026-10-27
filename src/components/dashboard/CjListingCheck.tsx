"use client";

import { useMemo, useRef, useState } from "react";

import { MIN_PROFIT_LABEL } from "@/lib/pricing";

type Verdict = "ok" | "thin" | "losing" | "ended" | "error";

type Result = {
  listingId: number;
  itemId: string;
  title: string;
  verdict: Verdict;
  price: number | null;
  shipping: number | null;
  cjCost: number | null;
  cjShipping: number | null;
  cjFrom: "CN" | "US" | null;
  usStock: number | null;
  profit: number | null;
  neededPrice: number | null;
  note: string;
};

/** Listings sent per request (the API takes up to 3: each needs ~5 s of eBay and CJ calls). */
const BATCH = 3;

const VERDICTS: Record<Verdict, { label: string; tone: string; order: number }> = {
  losing: { label: "Losing money", tone: "border-red-400/40 bg-red-400/10 text-red-200", order: 0 },
  thin: { label: `Under ${MIN_PROFIT_LABEL}`, tone: "border-amber-300/40 bg-amber-300/10 text-amber-200", order: 1 },
  ok: { label: "Profitable", tone: "border-lime-brand/40 bg-lime-brand/10 text-lime-brand", order: 2 },
  ended: { label: "Ended", tone: "border-white/15 bg-white/5 text-slate-400", order: 3 },
  error: { label: "Couldn't check", tone: "border-white/15 bg-white/5 text-slate-400", order: 4 },
};

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);

/**
 * "Check my CJ listings": every live listing made from a CJ product, re-costed
 * with CJ's real (stock-aware) shipping and the seller's real fees, so the ones
 * losing money or under the minimum profit can be repriced or ended.
 */
export function CjListingCheck({ ebayConnected }: { ebayConnected: boolean }) {
  const [results, setResults] = useState<Result[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);

  async function run() {
    setRunning(true);
    setError(null);
    setResults([]);
    stopRef.current = false;
    try {
      const listRes = await fetch("/api/cj-listing-check");
      const list = (await listRes.json()) as { ok: boolean; listings?: Array<{ listingId: number }>; error?: string };
      if (!list.ok || !list.listings) {
        setError(list.error ?? "Couldn't load your CJ listings.");
        return;
      }
      setTotal(list.listings.length);
      for (let i = 0; i < list.listings.length && !stopRef.current; i += BATCH) {
        const res = await fetch("/api/cj-listing-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ listingIds: list.listings.slice(i, i + BATCH).map((l) => l.listingId) }),
        });
        const json = (await res.json()) as { ok: boolean; results?: Result[]; error?: string };
        if (!json.ok || !json.results) {
          setError(json.error ?? "The check stopped. Press the button again to finish.");
          break;
        }
        setResults((current) => [...current, ...(json.results ?? [])]);
      }
    } catch {
      setError("The connection dropped. Press the button again to finish.");
    } finally {
      setRunning(false);
    }
  }

  const sorted = useMemo(
    () => [...results].sort((a, b) => VERDICTS[a.verdict].order - VERDICTS[b.verdict].order || (a.profit ?? 0) - (b.profit ?? 0)),
    [results],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const r of results) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    return c;
  }, [results]);

  function download() {
    const head = ["Verdict", "Item number", "Title", "Item price", "Buyer shipping", "CJ cost", "CJ shipping", "Ships from", "You keep", "Item price needed", "Details", "eBay link"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = sorted.map((r) =>
      [
        VERDICTS[r.verdict].label,
        r.itemId,
        r.title,
        r.price?.toFixed(2) ?? "",
        r.shipping?.toFixed(2) ?? "",
        r.cjCost?.toFixed(2) ?? "",
        r.cjShipping?.toFixed(2) ?? "",
        r.cjFrom ?? "",
        r.profit?.toFixed(2) ?? "",
        r.neededPrice?.toFixed(2) ?? "",
        r.note,
        `https://www.ebay.com/itm/${r.itemId}`,
      ]
        .map(String)
        .map(esc)
        .join(","),
    );
    const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cj-listing-check.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="ap-card space-y-3 rounded-2xl p-5">
      <h2 className="text-sm font-semibold text-white">Check my CJ listings</h2>
      <p className="text-xs leading-relaxed text-slate-400">
        {`Re-costs every live listing AutoPilot made from CJ with what a sale really costs today: CJ's price, CJ's shipping from a warehouse that actually has the item, your currency conversion and your real eBay fees (Settings → Listing defaults). Shows the ones losing money or keeping under ${MIN_PROFIT_LABEL}, with the item price that would fix them. Nothing on eBay is changed.`}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={running || !ebayConnected}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
        >
          {running ? `Checking… ${results.length}${total != null ? ` of ${total}` : ""}` : results.length ? "Check again" : "Check my CJ listings"}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => (stopRef.current = true)}
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
          >
            Stop
          </button>
        ) : null}
        {results.length && !running ? (
          <button type="button" onClick={download} className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5">
            Download results
          </button>
        ) : null}
        {total != null && !running ? <span className="text-xs text-slate-500">{`${total} CJ listing${total === 1 ? "" : "s"}, about 5 s each.`}</span> : null}
      </div>
      {error ? <p className="text-xs text-red-300">{error}</p> : null}

      {results.length ? (
        <>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(VERDICTS) as Verdict[])
              .filter((v) => counts[v])
              .map((v) => (
                <span key={v} className={`rounded-full border px-3 py-1 ${VERDICTS[v].tone}`}>
                  {`${counts[v]} ${VERDICTS[v].label.toLowerCase()}`}
                </span>
              ))}
          </div>
          <ul className="space-y-2">
            {sorted.map((r) => (
              <li key={r.listingId} className="min-w-0 space-y-1 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                  <a
                    href={`https://www.ebay.com/itm/${r.itemId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 text-sm text-white hover:underline"
                  >
                    {r.title}
                  </a>
                  <span className={`flex-none rounded-full border px-2.5 py-0.5 ${VERDICTS[r.verdict].tone}`}>{VERDICTS[r.verdict].label}</span>
                </div>
                {r.price != null ? (
                  <p className="text-slate-400">
                    {`Your price ${money(r.price)}${r.shipping ? ` + ${money(r.shipping)} shipping` : ""}`}
                    {r.profit != null ? ` · you keep ${money(r.profit)}` : ""}
                    {r.neededPrice != null ? (
                      <>
                        {" · "}
                        <span className="font-semibold text-lime-brand">{`raise to ${money(r.neededPrice)}`}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-slate-500">{r.note}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
