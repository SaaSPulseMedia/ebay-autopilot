import "server-only";

import { ebayRequest } from "@/lib/ebay/client";
import { marketQuery } from "@/lib/ebay/market-price";
import { getApplicationToken } from "@/lib/ebay/oauth";

/**
 * Is a product wanted on eBay, and how crowded is it? From the Browse API
 * (AutoPilot's application token):
 *  - listings: how many US fixed-price listings match the product's search
 *    (the competition);
 *  - sold: units the TOP_N best-matching listings have sold (eBay's
 *    estimatedSoldQuantity per listing): a strong number means buyers are
 *    actually buying this kind of product on eBay.
 * One search plus TOP_N item lookups, spaced GAP_MS apart, cached per server
 * instance for CACHE_TTL_MS (the Browse API allows 5,000 calls a day).
 */

const TOP_N = 5;
const GAP_MS = 200;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
/** A search matching fewer listings than this is retried with fewer words. */
const MIN_LISTINGS = 10;

export type EbayDemand = {
  /** Matching listings on eBay US (competition). */
  listings: number;
  /** Units sold by the top TOP_N matching listings; null when eBay didn't say. */
  sold: number | null;
  query: string;
};

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await task();
    } finally {
      lastCallAt = Date.now();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

const cache = new Map<string, { at: number; demand: EbayDemand | null }>();
const HEADERS = { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" };

type Search = { total?: number; itemSummaries?: Array<{ itemId?: string }> };
type Item = {
  estimatedAvailabilities?: Array<{ estimatedSoldQuantity?: number }>;
};

async function search(query: string, token: string) {
  const params = new URLSearchParams({
    q: query,
    limit: String(TOP_N),
    filter:
      "buyingOptions:{FIXED_PRICE},conditions:{NEW},deliveryCountry:US,priceCurrency:USD",
  });
  const res = await throttled(() =>
    ebayRequest<Search>(`/buy/browse/v1/item_summary/search?${params}`, token, {
      headers: HEADERS,
    }),
  );
  return res.body.errors?.length ? null : res.body;
}

/** eBay demand for a product title; null when eBay couldn't be asked or has nothing matching. */
export async function getEbayDemand(title: string): Promise<EbayDemand | null> {
  const query = marketQuery(title);
  if (!query) return null;
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.demand;

  const token = await getApplicationToken();
  if (!token) return null;
  // Supplier titles are wordy and eBay matches every word: fewer words until the search finds something real.
  let used = query;
  let found = await search(query, token);
  for (const words of [4, 3]) {
    const shorter = marketQuery(title, words);
    if (!found || (found.total ?? 0) >= MIN_LISTINGS || shorter === used)
      continue;
    used = shorter;
    found = await search(shorter, token);
  }
  if (!found) return null;

  const ids = (found.itemSummaries ?? [])
    .map((i) => i.itemId)
    .filter((id): id is string => Boolean(id))
    .slice(0, TOP_N);
  let sold: number | null = null;
  for (const id of ids) {
    const item = await throttled(() =>
      ebayRequest<Item>(
        `/buy/browse/v1/item/${encodeURIComponent(id)}`,
        token,
        { headers: HEADERS },
      ),
    );
    const qty = item.body.estimatedAvailabilities?.[0]?.estimatedSoldQuantity;
    if (typeof qty === "number" && qty >= 0) sold = (sold ?? 0) + qty;
  }
  const demand = { listings: found.total ?? ids.length, sold, query: used };
  console.log(
    `[ebay-demand] "${used}": ${demand.listings} listings, top ${ids.length} sold ${sold ?? "unknown"}`,
  );

  if (cache.size >= CACHE_MAX)
    cache.delete(cache.keys().next().value as string);
  cache.set(query, { at: Date.now(), demand });
  return demand;
}

/**
 * The finder's ranking: sales of the top listings, discounted by how crowded
 * the search is (going from 100 to 10,000 competing listings halves the score).
 * Null when sales are unknown.
 */
export function demandScore(sold: number | null, listings: number | null) {
  if (sold == null) return null;
  return (
    Math.round((sold / Math.log10(Math.max(0, listings ?? 0) + 10)) * 10) / 10
  );
}
