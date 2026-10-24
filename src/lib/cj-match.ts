import "server-only";

import { cjProductUrl } from "@/lib/cj/urls";
import { getCjShipping, searchCjProducts } from "@/lib/cj/catalog";
import { keywordWords } from "@/lib/cj/relevance";
import { netProfitFor } from "@/lib/pricing";

/**
 * "Find on CJ" for a listing sourced elsewhere (e.g. AliExpress): searches CJ
 * for the same product from the eBay title, ranks CJ's results by how much of
 * the title they share, and for the best few gets CJ's real shipping to the US
 * (cheapest and fastest method, and the warehouse) and the profit at the
 * listing's current eBay price. Only the seller can confirm it's the same
 * item (photos, size, material): the match score is a hint, not a promise.
 */

export type CjMatch = {
  pid: string;
  title: string;
  imageUrl: string | null;
  url: string;
  /** Share of the eBay title's words found in CJ's title, 0–1. */
  score: number;
  cost: number;
  /** Cheapest CJ method to the US. */
  shipping: number | null;
  days: string;
  from: "CN" | "US" | null;
  /** Fastest US-warehouse option, when CJ has one. */
  usOption: { price: number; days: string } | null;
  /** Net profit per sale at the listing's current eBay total, after CJ cost, shipping and eBay fees. */
  profit: number | null;
  shippingError?: string;
};

export type CjMatchResult = { ok: true; query: string; matches: CjMatch[] } | { ok: false; error: string };

/** CJ candidates whose shipping is looked up (3 CJ calls each, ~1.1 s apart). */
const DETAILED = 3;
/** Below this share of the title's words, a CJ result isn't shown as a match. */
const MIN_SCORE = 0.3;

const cents = (n: number) => Math.round(n * 100) / 100;

/** Plural-insensitive word form, matching relevance.ts's idea of "the same word". */
const stem = (w: string) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

function overlap(ebayWords: string[], cjTitle: string) {
  if (!ebayWords.length) return 0;
  const cj = new Set(keywordWords(cjTitle).map(stem));
  return ebayWords.filter((w) => cj.has(stem(w))).length / ebayWords.length;
}

export async function findOnCj(
  userId: number,
  ebayTitle: string,
  ebayTotal: number | null,
  adRatePct: number,
): Promise<CjMatchResult> {
  // eBay titles are keyword lists; CJ searches best on a few: the first five words, then the first three.
  const words = keywordWords(ebayTitle).filter((w) => !/^\d+$/.test(w));
  if (!words.length) return { ok: false, error: "The title has no words to search CJ with." };
  const queries = [...new Set([words.slice(0, 5).join(" "), words.slice(0, 3).join(" ")])];

  const found = new Map<string, { pid: string; title: string; imageUrl: string | null; price: number }>();
  let query = queries[0];
  for (const q of queries) {
    const res = await searchCjProducts(userId, q, 1);
    if (!res.ok) return { ok: false, error: res.error };
    for (const item of res.data.items) if (!found.has(item.pid) && item.price > 0) found.set(item.pid, item);
    query = q;
    if ([...found.values()].filter((i) => overlap(words, i.title) >= MIN_SCORE).length >= DETAILED) break;
  }

  const ranked = [...found.values()]
    .map((item) => ({ ...item, score: overlap(words, item.title) }))
    .filter((item) => item.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.price - b.price)
    .slice(0, DETAILED);

  const matches: CjMatch[] = [];
  for (const item of ranked) {
    const base = {
      pid: item.pid,
      title: item.title,
      imageUrl: item.imageUrl,
      url: cjProductUrl(item.pid, item.title),
      score: Math.round(item.score * 100) / 100,
      cost: item.price,
    };
    const quote = await getCjShipping(item.pid);
    if (!quote.ok || !quote.data.options.length) {
      matches.push({
        ...base,
        shipping: null,
        days: "",
        from: null,
        usOption: null,
        profit: null,
        shippingError: quote.ok ? "CJ has no shipping method to the US for it." : quote.error,
      });
      continue;
    }
    const cheapest = quote.data.options[0];
    const us = quote.data.options.filter((o) => o.from === "US").sort((a, b) => a.price - b.price)[0];
    matches.push({
      ...base,
      shipping: cheapest.price,
      days: cheapest.days,
      from: cheapest.from,
      usOption: us ? { price: us.price, days: us.days } : null,
      profit: ebayTotal != null ? cents(netProfitFor(ebayTotal, item.price, cheapest.price, adRatePct)) : null,
    });
  }
  return { ok: true, query, matches };
}

