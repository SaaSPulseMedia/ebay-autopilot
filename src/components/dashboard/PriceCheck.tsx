"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { MIN_PROFIT, MIN_PROFIT_LABEL, netProfitFor, priceForMinProfit } from "@/lib/pricing";

type Verdict = "overpriced" | "high" | "competitive" | "no_data" | "ended" | "error";

type Result = {
  itemId: string;
  title: string;
  verdict: Verdict;
  price: number | null;
  shipping: number | null;
  total: number | null;
  market: { average: number; reference: number; lowest: number; source: "sold" | "active"; count: number } | null;
  suggestedPrice: number | null;
  note: string;
};

type Listing = { itemId: string; title: string; views: number | null; sold: number | null };

/** Which listings from the report get checked. */
type Scope = "unsold" | "sellers" | "all";

/** Listings sent per request (the API takes up to 6). */
const BATCH = 5;

const VERDICTS: Record<Verdict, { label: string; tone: string; order: number }> = {
  overpriced: { label: "Overpriced", tone: "border-red-400/40 bg-red-400/10 text-red-200", order: 0 },
  high: { label: "A bit high", tone: "border-amber-300/40 bg-amber-300/10 text-amber-200", order: 1 },
  competitive: { label: "Price is fine", tone: "border-lime-brand/40 bg-lime-brand/10 text-lime-brand", order: 2 },
  no_data: { label: "Not enough to compare", tone: "border-white/15 bg-white/5 text-slate-300", order: 3 },
  ended: { label: "Ended", tone: "border-white/15 bg-white/5 text-slate-400", order: 4 },
  error: { label: "Couldn't check", tone: "border-white/15 bg-white/5 text-slate-400", order: 5 },
};

const money = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}`);
const cents = (n: number) => Math.round(n * 100) / 100;

/** The seller's cost per listing (what they pay their supplier, delivery included), kept in this browser. */
const COSTS_KEY = "price-check-costs";

type CostAdvice = {
  /** Profit per sale at the current price, after eBay fees and the ad rate. */
  profitNow: number;
  /** The suggested item price, never below the one that keeps MIN_PROFIT; null when the market can't be matched. */
  suggestedItem: number | null;
  tone: "ok" | "warn" | "bad";
  message: string;
};

/**
 * What the seller's own cost changes: eBay prices alone can suggest an item
 * price below what the item costs. With the cost known, the suggestion never
 * goes under the price that keeps MIN_PROFIT, and says so plainly when the
 * market price is out of reach with this supplier.
 */
function costAdvice(r: Result, cost: number, adRatePct: number): CostAdvice | null {
  if (r.total == null) return null;
  const shipping = r.shipping ?? 0;
  const profitNow = netProfitFor(r.total, cost, 0, adRatePct);
  const floorTotal = priceForMinProfit(cost, 0, adRatePct);
  const floorItem = cents(Math.max(0.99, floorTotal - shipping));
  const now = `Now you keep ${money(profitNow)} per sale after eBay fees${adRatePct ? " and ads" : ""}.`;
  const floor = `the lowest price that keeps ${MIN_PROFIT_LABEL} is ${money(floorTotal)}${shipping ? ` (item price ${money(floorItem)} + ${money(shipping)} shipping)` : ""}`;
  const m = r.market;
  if (!m) {
    return { profitNow, suggestedItem: null, tone: profitNow >= MIN_PROFIT ? "ok" : "warn", message: `${now} For you, ${floor}.` };
  }
  if (floorTotal <= m.reference) {
    const suggestedItem = r.suggestedPrice != null ? Math.max(r.suggestedPrice, floorItem) : null;
    const kept = suggestedItem != null ? netProfitFor(suggestedItem + shipping, cost, 0, adRatePct) : null;
    return {
      profitNow,
      suggestedItem,
      tone: "ok",
      message:
        suggestedItem != null && kept != null
          ? `${now} You can match the typical ${money(m.reference)}: at an item price of ${money(suggestedItem)} you'd keep ${money(kept)}.`
          : `${now} Your price is in line with eBay.`,
    };
  }
  if (floorTotal <= m.average) {
    return {
      profitNow,
      suggestedItem: r.suggestedPrice != null ? floorItem : null,
      tone: "warn",
      message: `${now} You can't reach the typical ${money(m.reference)} with this supplier: ${floor}, still under the eBay average (${money(m.average)}).`,
    };
  }
  return {
    profitNow,
    suggestedItem: null,
    tone: "bad",
    message: `${now} You can't match this price with your current supplier: ${floor}, above the eBay average (${money(m.average)}). Look for a cheaper source (Find on CJ), or end it if it doesn't sell.`,
  };
}

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const num = (value: string | undefined) => {
  const n = Number((value ?? "").replace(/[,%$\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Listings from either eBay report: the Listings traffic report (Performance
 * → Traffic: "eBay item ID", "Total page views", "Quantity sold") or the All
 * active listings report (Reports → Downloads: "Item number", "Sold quantity").
 */
function readReport(text: string): { listings: Listing[]; kind: "traffic" | "active" } | { error: string } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  const headerAt = rows.findIndex((r) => r.some((c) => /^(eBay item ID|Item number)$/i.test(c.trim())));
  if (headerAt < 0) return { error: "This doesn't look like an eBay listings report. Use the Listings traffic report or the All active listings report." };
  const header = rows[headerAt].map((c) => c.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const kind = header.includes("ebay item id") ? "traffic" : "active";
  const idCol = col("ebay item id", "item number");
  const titleCol = col("listing title", "title");
  const viewsCol = col("total page views");
  const soldCol = col("quantity sold", "sold quantity");
  const seen = new Map<string, Listing>();
  for (const r of rows.slice(headerAt + 1)) {
    const itemId = (r[idCol] ?? "").replace(/\D/g, "");
    const title = (r[titleCol] ?? "").trim();
    if (!itemId || !title || seen.has(itemId)) continue;
    seen.set(itemId, {
      itemId,
      title,
      views: viewsCol >= 0 ? num(r[viewsCol]) : null,
      sold: soldCol >= 0 ? num(r[soldCol]) : null,
    });
  }
  if (!seen.size) return { error: "No listings found in this file." };
  return { listings: [...seen.values()], kind };
}

export function PriceCheck({ ebayConnected, adRatePct }: { ebayConnected: boolean; adRatePct: number }) {
  const [costs, setCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COSTS_KEY) ?? "{}") as unknown;
      if (saved && typeof saved === "object") setCosts(saved as Record<string, number>);
    } catch {
      // No saved costs (private window, blocked storage): the boxes start empty.
    }
  }, []);
  function setCost(itemId: string, value: number | null) {
    setCosts((current) => {
      const next = { ...current };
      if (value == null) delete next[itemId];
      else next[itemId] = value;
      try {
        localStorage.setItem(COSTS_KEY, JSON.stringify(next));
      } catch {
        // Not saved for next time; still used on this page.
      }
      return next;
    });
  }

  const [listings, setListings] = useState<Listing[]>([]);
  const [kind, setKind] = useState<"traffic" | "active" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("unsold");
  const [results, setResults] = useState<Result[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const stopRef = useRef(false);

  /** "unsold": opened (10+ views, traffic report) but not bought. "sellers": sold at least once. */
  const toCheck = useMemo(() => {
    if (scope === "sellers") return listings.filter((l) => (l.sold ?? 0) > 0);
    if (scope === "unsold") return listings.filter((l) => (l.sold ?? 0) === 0 && (kind !== "traffic" || (l.views ?? 0) >= 10));
    return listings;
  }, [listings, scope, kind]);

  async function onFile(file: File | undefined) {
    setFileError(null);
    setResults([]);
    setListings([]);
    if (!file) return;
    const read = readReport(await file.text());
    if ("error" in read) {
      setFileError(read.error);
      return;
    }
    setListings(read.listings);
    setKind(read.kind);
  }

  async function run() {
    setRunning(true);
    setRunError(null);
    setResults([]);
    stopRef.current = false;
    // Best sellers by sales; otherwise most-viewed first, so the listings losing the most buyers come first.
    const queue = [...toCheck].sort((a, b) =>
      scope === "sellers" ? (b.sold ?? 0) - (a.sold ?? 0) || (b.views ?? 0) - (a.views ?? 0) : (b.views ?? 0) - (a.views ?? 0),
    );
    try {
      for (let i = 0; i < queue.length && !stopRef.current; i += BATCH) {
        const res = await fetch("/api/price-check", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: queue.slice(i, i + BATCH).map(({ itemId, title }) => ({ itemId, title })) }),
        });
        const json = (await res.json()) as { ok: boolean; results?: Result[]; error?: string };
        if (!json.ok || !json.results) {
          setRunError(json.error ?? "The check stopped. Try again.");
          break;
        }
        setResults((current) => [...current, ...(json.results ?? [])]);
      }
    } catch {
      setRunError("The connection dropped. Press Check prices again to finish.");
    } finally {
      setRunning(false);
    }
  }

  const sorted = useMemo(
    () => [...results].sort((a, b) => VERDICTS[a.verdict].order - VERDICTS[b.verdict].order),
    [results],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<Verdict, number>> = {};
    for (const r of results) c[r.verdict] = (c[r.verdict] ?? 0) + 1;
    return c;
  }, [results]);

  function download() {
    const head = ["Verdict", "Item number", "Title", "Your price", "Your shipping", "Your total", "eBay average", "Typical price", "Suggested item price", "My cost", "Profit now", "What to do", "eBay link"];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = sorted.map((r) => {
      const cost = costs[r.itemId];
      const advice = cost != null ? costAdvice(r, cost, adRatePct) : null;
      return [
        VERDICTS[r.verdict].label,
        r.itemId,
        r.title,
        r.price?.toFixed(2) ?? "",
        r.shipping?.toFixed(2) ?? "",
        r.total?.toFixed(2) ?? "",
        r.market?.average.toFixed(2) ?? "",
        r.market?.reference.toFixed(2) ?? "",
        (advice ? advice.suggestedItem : r.suggestedPrice)?.toFixed(2) ?? "",
        cost?.toFixed(2) ?? "",
        advice?.profitNow.toFixed(2) ?? "",
        advice ? `${advice.message} ${r.note}` : r.note,
        `https://www.ebay.com/itm/${r.itemId}`,
      ]
        .map(String)
        .map(esc)
        .join(",");
    });
    const blob = new Blob([[head.map(esc).join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "price-check.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-5">
      {!ebayConnected ? (
        <p className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
          Connect your eBay store in Settings first: the price check reads each listing&apos;s live price from eBay.
        </p>
      ) : null}

      <section className="ap-card space-y-3 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white">Step 1 · Upload your eBay report</h2>
        <p className="text-xs leading-relaxed text-slate-400">
          Best: the <span className="text-slate-200">Listings traffic report</span> (Seller Hub → Performance → Traffic → download the
          per-listing table). It also works with the <span className="text-slate-200">All active listings</span> report (Seller Hub →
          Reports → Downloads). The file stays on your computer; only item numbers and titles are sent for checking.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-full file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-400"
        />
        {fileError ? <p className="text-xs text-red-300">{fileError}</p> : null}
        {listings.length ? (
          <div className="space-y-2 text-sm text-slate-300">
            <p>
              Found <span className="text-white">{listings.length}</span> listings in your{" "}
              {kind === "traffic" ? "traffic report" : "active listings report"}.
            </p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["unsold", kind === "traffic" ? "Opened but not bought (10+ views, no sales)" : "No sales"],
                  ["sellers", "Best sellers (to move to CJ)"],
                  ["all", "All listings"],
                ] as Array<[Scope, string]>
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => (setScope(value), setResults([]))}
                  aria-pressed={scope === value}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    scope === value ? "border-brand-500 bg-brand-500/20 text-white" : "border-white/15 text-slate-300 hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {listings.length ? (
        <section className="ap-card space-y-3 rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white">Step 2 · Check prices</h2>
          <p className="text-xs text-slate-400">
            {toCheck.length} listing{toCheck.length === 1 ? "" : "s"} to check, about {Math.max(1, Math.ceil((toCheck.length * 2.5) / 60))}{" "}
            minute{toCheck.length * 2.5 > 60 ? "s" : ""}. Keep this page open while it runs. Nothing on eBay is changed.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={running || !toCheck.length || !ebayConnected}
              className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400 disabled:opacity-50"
            >
              {running ? `Checking… ${results.length} of ${toCheck.length}` : results.length ? "Check again" : "Check prices"}
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
          </div>
          {runError ? <p className="text-xs text-red-300">{runError}</p> : null}
        </section>
      ) : null}

      {results.length ? (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-white">Step 3 · Results</h2>
          <div className="flex flex-wrap gap-2 text-xs">
            {(Object.keys(VERDICTS) as Verdict[])
              .filter((v) => counts[v])
              .map((v) => (
                <span key={v} className={`rounded-full border px-3 py-1 ${VERDICTS[v].tone}`}>
                  {counts[v]} {VERDICTS[v].label.toLowerCase()}
                </span>
              ))}
          </div>
          <ul className="space-y-2">
            {sorted.map((r) => {
              const cost = costs[r.itemId];
              const advice = cost != null ? costAdvice(r, cost, adRatePct) : null;
              const suggested = advice ? advice.suggestedItem : r.suggestedPrice;
              return (
                <li key={r.itemId} className="ap-card min-w-0 space-y-1.5 rounded-2xl p-3 text-xs">
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
                  <p className="text-slate-400">
                    You: <span className="text-white">{money(r.total)}</span>
                    {r.shipping ? ` (${money(r.price)} + ${money(r.shipping)} shipping)` : r.total != null ? " (free shipping)" : ""}
                    {r.market ? (
                      <>
                        {" "}
                        · eBay average {money(r.market.average)} · typical {money(r.market.reference)}
                        {r.market.source === "sold" ? " (sold)" : ""}
                      </>
                    ) : null}
                    {suggested != null ? (
                      <>
                        {" "}
                        · suggested item price <span className="font-semibold text-lime-brand">{money(suggested)}</span>
                      </>
                    ) : null}
                  </p>
                  <p className="text-slate-500">{r.note}</p>
                  {r.total != null ? (
                    <MyCost key={`${r.itemId}:${cost ?? ""}`} value={cost} onChange={(value) => setCost(r.itemId, value)} />
                  ) : null}
                  {advice ? (
                    <p
                      className={`rounded-xl border px-3 py-2 ${
                        advice.tone === "ok"
                          ? "border-lime-brand/30 bg-lime-brand/10 text-lime-brand"
                          : advice.tone === "warn"
                            ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                            : "border-red-400/30 bg-red-400/10 text-red-200"
                      }`}
                    >
                      {advice.message}
                    </p>
                  ) : null}
                  {r.verdict !== "ended" ? <FindOnCj title={r.title} total={r.total} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** "My cost" box: what the seller pays their supplier for one, delivery to the buyer included. */
function MyCost({ value, onChange }: { value: number | undefined; onChange: (value: number | null) => void }) {
  const [text, setText] = useState(value != null ? value.toFixed(2) : "");
  function save() {
    const n = Number(text.replace(/[$,\s]/g, ""));
    if (!text.trim()) onChange(null);
    else if (Number.isFinite(n) && n > 0 && n !== value) onChange(cents(n));
  }
  return (
    <label className="flex flex-wrap items-center gap-2 text-slate-400">
      {"My cost (what you pay your supplier, delivery included): $"}
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        placeholder="e.g. 10.99"
        className="w-24 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-white placeholder:text-slate-600 focus:border-brand-500 focus:outline-none"
      />
    </label>
  );
}

type CjMatch = {
  pid: string;
  title: string;
  imageUrl: string | null;
  url: string;
  score: number;
  cost: number;
  shipping: number | null;
  days: string;
  from: "CN" | "US" | null;
  usOption: { price: number; days: string } | null;
  profit: number | null;
  shippingError?: string;
};

/**
 * "Find on CJ" for one listing: CJ products matching its title, with CJ's
 * real cost, shipping, delivery time and the profit at the listing's current
 * eBay price. The seller confirms it's the same item by comparing photos.
 */
function FindOnCj({ title, total }: { title: string; total: number | null }) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; query: string; matches: CjMatch[] }
    | { status: "error"; error: string }
  >({ status: "idle" });

  async function search() {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/cj-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, total }),
      });
      const json = (await res.json()) as { ok: boolean; query?: string; matches?: CjMatch[]; error?: string };
      setState(json.ok ? { status: "done", query: json.query ?? "", matches: json.matches ?? [] } : { status: "error", error: json.error ?? "CJ search failed." });
    } catch {
      setState({ status: "error", error: "CJ search didn't finish. Try again." });
    }
  }

  if (state.status === "idle") {
    return (
      <button type="button" onClick={search} className="mt-1 rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/5">
        Find on CJ
      </button>
    );
  }
  if (state.status === "loading") return <p className="text-slate-400">Searching CJ and getting real shipping… (up to 20 s)</p>;
  if (state.status === "error") {
    return (
      <p className="text-red-300">
        {state.error}{" "}
        <button type="button" onClick={search} className="underline">
          Try again
        </button>
      </p>
    );
  }
  if (!state.matches.length) {
    return (
      <p className="rounded-xl border border-white/12 bg-white/5 px-3 py-2 text-slate-300">
        No close match on CJ for &quot;{state.query}&quot;. In your CJ account, post a <span className="text-white">{"sourcing request "}</span>with
        this product&apos;s AliExpress link: CJ usually finds it within a few days, and it then shows up here.
      </p>
    );
  }
  return (
    <div className="mt-1 space-y-2 rounded-xl border border-white/12 bg-white/5 p-2.5">
      <p className="text-slate-400">
        CJ matches for &quot;{state.query}&quot;. Compare the photos: only switch if it&apos;s the same item.
      </p>
      {state.matches.map((m) => (
        <div key={m.pid} className="flex min-w-0 gap-2.5">
          {m.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.imageUrl} alt="" className="h-14 w-14 flex-none rounded-lg object-cover" />
          ) : (
            <div className="h-14 w-14 flex-none rounded-lg bg-white/5" />
          )}
          <div className="min-w-0 flex-1 space-y-0.5">
            <a href={m.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-white hover:underline">
              {m.title}
            </a>
            <p className="text-slate-400">
              CJ {money(m.cost)} + shipping {m.shipping == null ? "—" : m.shipping === 0 ? "free" : money(m.shipping)}
              {m.days ? ` · ${m.days} days` : ""}
              {m.from ? ` from ${m.from === "US" ? "US warehouse 🇺🇸" : "China"}` : ""}
              {m.usOption && m.from !== "US" ? ` · US warehouse: ${money(m.usOption.price)}, ${m.usOption.days} days` : ""}
            </p>
            {m.profit != null ? (
              <p className={m.profit >= MIN_PROFIT ? "text-lime-brand" : "text-amber-200"}>
                Profit at your current eBay price: {money(m.profit)}
                {m.profit < MIN_PROFIT ? ` (under ${MIN_PROFIT_LABEL}: the price would need to go up)` : ""}
              </p>
            ) : null}
            {m.shippingError ? <p className="text-amber-200">{m.shippingError}</p> : null}
            <p className="text-slate-500">Title match {Math.round(m.score * 100)}%</p>
          </div>
        </div>
      ))}
    </div>
  );
}
