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

/** The price actually set: up to the next .99 (same as the server's charmUp). */
const charmUp = (n: number) => Math.ceil(n + 0.01) - 0.01;

type Fix = { state: "working" | "done" | "failed"; note: string };

/** A rise this big (vs the live price) may stop buyers: the row says ending could be better. */
const BIG_JUMP = 1.4;

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
  const [fixes, setFixes] = useState<Record<number, Fix>>({});
  const [fixing, setFixing] = useState(false);

  async function fixOne(listingId: number) {
    setFixes((f) => ({ ...f, [listingId]: { state: "working", note: "Raising the price on eBay…" } }));
    try {
      const res = await fetch("/api/cj-listing-check/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; fix?: { ok: boolean; note: string } };
      const fix = json.fix;
      setFixes((f) => ({
        ...f,
        [listingId]: fix ? { state: fix.ok ? "done" : "failed", note: fix.note } : { state: "failed", note: json.error ?? "Couldn't change the price." },
      }));
    } catch {
      setFixes((f) => ({ ...f, [listingId]: { state: "failed", note: "The connection dropped. Try again." } }));
    }
  }

  async function fixAll() {
    const todo = sorted.filter((r) => r.neededPrice != null && fixes[r.listingId]?.state !== "done");
    if (!todo.length) return;
    if (!window.confirm(`Raise the price of ${todo.length} listing${todo.length === 1 ? "" : "s"} on eBay now, so each one keeps at least ${MIN_PROFIT_LABEL} per sale?`)) return;
    setFixing(true);
    stopRef.current = false;
    for (const r of todo) {
      if (stopRef.current) break;
      await fixOne(r.listingId);
    }
    setFixing(false);
  }

  async function run() {
    setRunning(true);
    setError(null);
    setResults([]);
    setFixes({});
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

  const fixable = sorted.filter((r) => r.neededPrice != null && fixes[r.listingId]?.state !== "done").length;
  const noFix = sorted.filter((r) => r.verdict === "losing" && r.neededPrice == null).length;

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
          {fixable && !running ? (
            <div className="space-y-2 rounded-xl border border-lime-brand/30 bg-lime-brand/5 p-3 text-xs text-slate-300">
              <p>
                {`${fixable} listing${fixable === 1 ? " needs" : "s need"} a higher price. One click raises them all on eBay to the price shown (every size and colour goes up in step), so each sale keeps at least ${MIN_PROFIT_LABEL}. With your eBay store, a listing that doesn't sell at the new price costs you nothing; one that sells at a loss does.`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void fixAll()}
                  disabled={fixing}
                  className="rounded-full bg-lime-brand px-4 py-2 text-sm font-semibold text-slate-950 hover:opacity-90 disabled:opacity-50"
                >
                  {fixing ? "Raising prices…" : `Raise all ${fixable} prices for me`}
                </button>
                {fixing ? (
                  <button
                    type="button"
                    onClick={() => (stopRef.current = true)}
                    className="rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
                  >
                    Stop
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          {noFix && !running ? (
            <p className="text-xs text-amber-200">{`${noFix} listing${noFix === 1 ? "" : "s"} can't be fixed with a price because CJ can't ship ${noFix === 1 ? "it" : "them"} to the US right now: end ${noFix === 1 ? "it" : "them"} in eBay Seller Hub.`}</p>
          ) : null}
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
                        <span className="font-semibold text-lime-brand">{`raise to ${money(charmUp(r.neededPrice))}`}</span>
                      </>
                    ) : null}
                  </p>
                ) : null}
                <p className="text-slate-500">{r.note}</p>
                {r.neededPrice != null && r.price && r.neededPrice / r.price > BIG_JUMP ? (
                  <p className="text-amber-200">{`A big rise (${Math.round((r.neededPrice / r.price - 1) * 100)}%): if it stops selling at that price, end it.`}</p>
                ) : null}
                {fixes[r.listingId] ? (
                  <p className={fixes[r.listingId].state === "failed" ? "text-red-300" : fixes[r.listingId].state === "done" ? "text-lime-brand" : "text-slate-300"}>
                    {fixes[r.listingId].note}
                  </p>
                ) : r.neededPrice != null && !fixing ? (
                  <button
                    type="button"
                    onClick={() => void fixOne(r.listingId)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/5"
                  >
                    {`Raise to ${money(charmUp(r.neededPrice))} on eBay`}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
