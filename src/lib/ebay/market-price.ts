import "server-only";

import { ebayErrorMessage, ebayRequest } from "@/lib/ebay/client";
import { getApplicationToken } from "@/lib/ebay/oauth";
import { MARKET_MATCH_MAX_ABOVE } from "@/lib/pricing";

/**
 * What a product sells for on eBay right now, from the Browse API's item
 * search (AutoPilot's application token, so no seller account is needed):
 * the top 10 new, fixed-price US listings for a cleaned-up version of the
 * title, priced as item + shipping, averaged with the highest and lowest
 * dropped. Active listings, not sold ones: eBay's sold data (Marketplace
 * Insights) needs separate approval.
 *
 * Calls go through one queue spaced BROWSE_GAP_MS apart and results are
 * cached per server instance for CACHE_TTL_MS (the Browse API allows 5,000
 * calls a day per application).
 */

const BROWSE_GAP_MS = 200;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 1000;
const SAMPLE = 10;
/** Fewer listings than this is too thin to price against. */
export const MIN_MARKET_LISTINGS = 3;

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + BROWSE_GAP_MS - Date.now();
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

export type MarketPrice = { average: number; count: number; query: string };
export type MarketLookup = { ok: true; market: MarketPrice | null } | { ok: false; error: string };

const cache = new Map<string, { at: number; market: MarketPrice | null }>();

/** Supplier filler that makes eBay's keyword search miss ("2024 New Hot Sale …"). */
const NOISE = new Set(
  "new hot sale sales selling best free shipping fast high quality top newest latest arrival arrivals style styles fashion fashionable creative wholesale dropshipping drop the a an and or for with of in on to by from pcs pc piece pieces 1pc 2pcs".split(
    " ",
  ),
);

/** The eBay search for a supplier title: its first few meaningful words. */
export function marketQuery(title: string, words = 6) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w) && !/^(19|20)\d\d$/.test(w))
    .slice(0, words)
    .join(" ");
}

type BrowseSearch = {
  total?: number;
  itemSummaries?: Array<{
    price?: { value?: string; currency?: string };
    shippingOptions?: Array<{ shippingCost?: { value?: string } }>;
  }>;
};

async function searchOnce(query: string, token: string): Promise<MarketLookup> {
  const params = new URLSearchParams({
    q: query,
    limit: String(SAMPLE),
    filter: "buyingOptions:{FIXED_PRICE},conditions:{NEW},deliveryCountry:US,priceCurrency:USD",
  });
  const res = await throttled(() =>
    ebayRequest<BrowseSearch>(`/buy/browse/v1/item_summary/search?${params}`, token, {
      headers: { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    }),
  );
  if (res.body.errors?.length) return { ok: false, error: ebayErrorMessage(res.body, `eBay returned HTTP ${res.status}`) };

  const prices = (res.body.itemSummaries ?? [])
    .filter((item) => !item.price?.currency || item.price.currency === "USD")
    .map((item) => Number(item.price?.value) + (Number(item.shippingOptions?.[0]?.shippingCost?.value) || 0))
    .filter((p) => Number.isFinite(p) && p > 0)
    .slice(0, SAMPLE);
  if (prices.length < MIN_MARKET_LISTINGS) return { ok: true, market: null };
  // Drop the cheapest and dearest so one accessory or bundle doesn't skew it.
  const sorted = [...prices].sort((a, b) => a - b);
  const kept = sorted.length >= 5 ? sorted.slice(1, -1) : sorted;
  const average = kept.reduce((sum, p) => sum + p, 0) / kept.length;
  return { ok: true, market: { average: Math.round(average * 100) / 100, count: prices.length, query } };
}

/**
 * The eBay market price for a product title. `market` is null when eBay has
 * too few matching listings to judge. A long title that finds too little is
 * retried once with its first 4 meaningful words.
 */
export async function getMarketPrice(title: string): Promise<MarketLookup> {
  const query = marketQuery(title);
  if (!query) return { ok: true, market: null };
  const hit = cache.get(query);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { ok: true, market: hit.market };

  const token = await getApplicationToken();
  if (!token) return { ok: false, error: "eBay API credentials are not configured." };

  let result = await searchOnce(query, token);
  const shorter = marketQuery(title, 4);
  if (result.ok && !result.market && shorter !== query) result = await searchOnce(shorter, token);
  if (!result.ok) {
    console.warn(`[market-price] "${query}": ${result.error}`);
    return result;
  }

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(query, { at: Date.now(), market: result.market });
  return result;
}

/** Listings priced more than this far above the market average are blocked at publish (shared with market-match pricing). */
export const MAX_ABOVE_MARKET = MARKET_MATCH_MAX_ABOVE;

/**
 * Publish-time guard: an error message when `price` is more than 20% above
 * the eBay market average for `title`, else null. Never blocks on missing
 * data (no credentials, eBay unreachable, too few listings), and is off when
 * MARKET_PRICE_GUARD=off.
 */
export async function marketPriceWarning(title: string, price: number): Promise<string | null> {
  if (process.env.MARKET_PRICE_GUARD === "off") return null;
  const lookup = await getMarketPrice(title);
  if (!lookup.ok || !lookup.market) {
    console.log(`[market-guard] "${title.slice(0, 60)}": no market price (${lookup.ok ? "too few listings" : lookup.error}); allowed.`);
    return null;
  }
  const { average } = lookup.market;
  if (price <= average * (1 + MAX_ABOVE_MARKET)) return null;
  console.warn(`[market-guard] blocked "${title.slice(0, 60)}": $${price.toFixed(2)} vs market $${average.toFixed(2)}`);
  return `Market Price Warning: Listing at $${price.toFixed(2)} but market is $${average.toFixed(2)}.`;
}
