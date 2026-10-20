import "server-only";

import { ebayErrorMessage, ebayRequest } from "@/lib/ebay/client";
import { INSIGHTS_SCOPE, getApplicationToken } from "@/lib/ebay/oauth";
import { MARKET_MATCH_MAX_ABOVE } from "@/lib/pricing";

/**
 * What a product sells for on eBay, for a cleaned-up version of its title
 * (AutoPilot's application token, so no seller account is needed):
 *  - sold: the median price it actually sold at over the last 90 days,
 *    weighted by quantity sold, from the Marketplace Insights API. eBay only
 *    grants that API to approved apps; until then it is skipped (re-checked
 *    hourly) and `sold` is null;
 *  - active: the top 10 new, fixed-price US listings from the Browse API,
 *    priced as item + shipping: their average (highest and lowest dropped),
 *    which the Market Guard compares against, and their lower quartile, the
 *    price competitive listings actually ask.
 * `reference` is the price to compete at: the sold median when there is one,
 * otherwise the active lower quartile (never the active average, which runs
 * high because unsold, overpriced listings stay up).
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

export type MarketPrice = {
  /** Active listings' trimmed average (item + shipping): what the Market Guard compares against. */
  average: number;
  /** Active listings' lower quartile: the competitive end of what's listed now. */
  low: number;
  /** Active listings sampled. */
  count: number;
  query: string;
  /** Median sold price over the last 90 days and how many sales it covers; null without sold data. */
  sold: { price: number; count: number } | null;
  /** The price to compete at: `sold.price` when there is one, else `low`. */
  reference: number;
  referenceSource: "sold" | "active";
};
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
  const average = cents(kept.reduce((sum, p) => sum + p, 0) / kept.length);
  const low = cents(quantile(kept, 0.25));
  return {
    ok: true,
    market: { average, low, count: prices.length, query, sold: null, reference: low, referenceSource: "active" },
  };
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Linear-interpolated quantile of an ascending list. */
function quantile(sorted: number[], q: number) {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

/** Sales sampled per sold-price lookup, and the fewest that make a usable median. */
const SOLD_SAMPLE = 50;
const MIN_SOLD = 3;
/** After eBay refuses Marketplace Insights (app not approved), wait this long before asking again. */
const INSIGHTS_RETRY_MS = 60 * 60 * 1000;
let insightsOffUntil = 0;

type ItemSales = {
  itemSales?: Array<{ lastSoldPrice?: { value?: string; currency?: string }; totalSoldQuantity?: number }>;
};

/**
 * Median sold price (quantity-weighted, item price) over the last 90 days,
 * Marketplace Insights' default window. Null when there are too few sales or
 * the API isn't available to this app (EBAY_SOLD_PRICES=off skips it).
 */
async function soldPrice(query: string): Promise<{ price: number; count: number } | null> {
  if (process.env.EBAY_SOLD_PRICES === "off" || Date.now() < insightsOffUntil) return null;
  const token = await getApplicationToken(INSIGHTS_SCOPE);
  if (!token) {
    insightsOffUntil = Date.now() + INSIGHTS_RETRY_MS;
    console.warn("[market-price] Marketplace Insights unavailable (scope refused); using active listings for an hour.");
    return null;
  }
  const params = new URLSearchParams({
    q: query,
    limit: String(SOLD_SAMPLE),
    filter: "buyingOptions:{FIXED_PRICE},conditions:{NEW},priceCurrency:USD",
  });
  const res = await throttled(() =>
    ebayRequest<ItemSales>(`/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, token, {
      headers: { "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
    }),
  );
  if (res.body.errors?.length) {
    if (res.status === 401 || res.status === 403) insightsOffUntil = Date.now() + INSIGHTS_RETRY_MS;
    console.warn(`[market-price] sold prices for "${query}": ${ebayErrorMessage(res.body, `HTTP ${res.status}`)}`);
    return null;
  }

  const sales = (res.body.itemSales ?? [])
    .filter((s) => !s.lastSoldPrice?.currency || s.lastSoldPrice.currency === "USD")
    .map((s) => ({ price: Number(s.lastSoldPrice?.value), qty: Math.max(1, Math.floor(s.totalSoldQuantity ?? 1)) }))
    .filter((s) => Number.isFinite(s.price) && s.price > 0)
    .sort((a, b) => a.price - b.price);
  const units = sales.reduce((sum, s) => sum + s.qty, 0);
  if (sales.length < MIN_SOLD) return null;
  let seen = 0;
  for (const sale of sales) {
    seen += sale.qty;
    if (seen * 2 >= units) return { price: cents(sale.price), count: units };
  }
  return null;
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
  if (result.market) {
    const sold = await soldPrice(result.market.query);
    if (sold) result = { ok: true, market: { ...result.market, sold, reference: sold.price, referenceSource: "sold" } };
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
