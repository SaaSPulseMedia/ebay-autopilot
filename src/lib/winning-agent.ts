import "server-only";

import { suggestNicheKeywords } from "@/lib/ai";
import {
  type KeywordSearchStat,
  type WinningFilters,
  type WinningProduct,
  cjCategoryScope,
  getKeywordWinners,
  getWinningProducts,
  inCategoryScope,
} from "@/lib/cj/catalog";
import { type MarketCheckSummary, applyMarketCheck } from "@/lib/market-check";
import type { NICHES } from "@/lib/niches";
import { markSeen, seenPids, usedKeywords } from "@/lib/seen-products";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * "✨ Auto-Suggest Winners" as a sourcing agent that only shows the seller
 * products they haven't seen:
 *  1. Claude picks 5 niche, trending and seasonal keywords for the niche,
 *     avoiding keywords this seller already used there;
 *  2. CJ is searched for them (up to 100 results each, through the 1.1 s
 *     queue), leaving out every product already in seen_products (shown,
 *     rejected or dismissed) and every product outside the niche's own CJ
 *     categories (cjCategoryScope: the niche's `cj` matched against CJ's
 *     category tree, so a "Home & Garden" run never returns phone cases);
 *  3. if fewer than MIN_FRESH fresh products are left, CJ is asked directly
 *     for products in a few of the niche's categoryIds, then, if still short,
 *     the keywords are searched again on random deeper CJ pages, while time
 *     allows;
 *  4. the fresh pool is scored (Winning Score) and the top is checked against
 *     eBay's market price (Market Guard check: below break-even is dropped);
 *  5. the best RETURNED are returned and recorded as seen, along with the
 *     ones the market check dropped, so neither comes back.
 * Every stage watches the clock so the request answers inside 60 s.
 */

/** Products returned per run. */
export const RETURNED = 30;
/** Fewer fresh products than this after a search round triggers a deeper-page retry. */
const MIN_FRESH = 10;
const MAX_RETRIES = 2;
/** Don't start a retry round after this long (a round is ~6–11 s of CJ calls). */
const RETRY_BEFORE_MS = 32_000;
/** Stop starting eBay market lookups after this long. */
const MARKET_DEADLINE_MS = 50_000;
/** Products checked against eBay: a few more than are returned, to replace ones the check drops. */
const MARKET_CHECK_COUNT = 40;
/** Deepest CJ page a retry picks from (CJ results thin out and repeat far down). */
const MAX_PAGE = 20;
const PAGE_SIZE = 100;

type Niche = (typeof NICHES)[number];

export type ScoutResult = {
  keywords: string[];
  /** CJ top-level categories the niche was limited to (empty when CJ's category list couldn't be matched). */
  categories: string[];
  /** Keyword results dropped for being outside the niche's CJ categories. */
  offCategory: number;
  keywordSource: "claude" | "fallback";
  searches: KeywordSearchStat[];
  /** Fresh (never-shown) CJ products found across all rounds, before the page's filters. */
  pooled: number;
  hiddenByFilters: number;
  /** Products this seller had already been shown before this run. */
  seenBefore: number;
  /** Deeper-page rounds run because the first found too few fresh products. */
  retries: number;
  market: MarketCheckSummary;
  products: WinningProduct[];
};

const randomInt = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));

/** CJ categoryIds asked for directly when the keywords find too few in-category products (2 CJ calls each). */
const CATEGORY_TOP_UP = 3;

/** A random `n` of `items` (Fisher–Yates on a copy). */
function sample<T>(items: T[], n: number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

export async function scoutWinners(
  userId: number,
  niche: Niche,
  filters: Omit<WinningFilters, "category" | "limit">,
  started = Date.now(),
): Promise<{ ok: true; data: ScoutResult } | { ok: false; error: string; status: number }> {
  const [seen, avoid, defaults, scope] = await Promise.all([
    seenPids(userId),
    usedKeywords(userId, niche.name),
    getListingDefaults(userId),
    cjCategoryScope(niche.cj),
  ]);
  if (!scope) console.warn(`[winning-agent] niche="${niche.name}": no matching CJ categories; results are not category-filtered.`);
  let offCategory = 0;
  const inNiche = (list: WinningProduct[]) => {
    if (!scope) return list;
    const kept = list.filter((p) => inCategoryScope(p.category, scope, niche.cj));
    offCategory += list.length - kept.length;
    return kept;
  };
  const suggestion = await suggestNicheKeywords(niche.name, niche.fallback, avoid);
  const keywords = suggestion.keywords;
  const scoring = { ...filters, limit: 1000 };

  // Round 1: page 1 of each keyword, minus everything already seen.
  const exclude = new Set(seen);
  const first = await getKeywordWinners(userId, keywords, scoring, { exclude });
  if (!first.ok) return first;
  const searches = [...first.data.searches];
  let products = inNiche(first.data.products);
  let pooled = first.data.pooled;
  let hiddenByFilters = first.data.hiddenByFilters;
  for (const p of first.data.products) exclude.add(p.pid);

  // Too few in-category products: ask CJ for products in the niche's own categoryIds.
  let topUp = 0;
  if (scope && products.length < MIN_FRESH && Date.now() - started < RETRY_BEFORE_MS) {
    const more = await getWinningProducts(userId, { ...scoring, categoryIds: sample(scope.ids, CATEGORY_TOP_UP), exclude });
    if (more.ok) {
      topUp = more.data.length;
      for (const p of more.data) exclude.add(p.pid);
      products = [...products, ...more.data].sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
    }
  }

  // Rounds 2+: random deeper pages. Each keyword's deeper pages are searched
  // with the phrase that found its results: a long keyword usually finds a
  // handful and its broader phrase ("… spin scrubber" → "spin scrubber") the rest.
  const deep = new Map<string, number>();
  for (const s of first.data.searches) {
    const query = s.broadenedTo && (s.broadTotal ?? 0) > (s.total ?? 0) ? s.broadenedTo : s.keyword;
    deep.set(query, Math.max(deep.get(query) ?? 0, s.broadenedTo === query ? (s.broadTotal ?? 0) : (s.total ?? 0)));
  }
  const triedPages = new Map([...deep.keys()].map((q) => [q, new Set([1])]));
  let retries = 0;
  while (products.length < MIN_FRESH && retries < MAX_RETRIES && Date.now() - started < RETRY_BEFORE_MS) {
    const pageFor = new Map<string, number>();
    for (const [query, total] of deep) {
      const lastPage = Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE));
      const tried = triedPages.get(query) ?? new Set<number>();
      const options = Array.from({ length: Math.max(0, lastPage - 1) }, (_, i) => i + 2).filter((p) => !tried.has(p));
      if (!options.length) continue;
      const page = options[randomInt(0, options.length - 1)];
      tried.add(page);
      pageFor.set(query, page);
    }
    if (!pageFor.size) break;
    retries++;
    const more = await getKeywordWinners(userId, [...pageFor.keys()], scoring, {
      exclude,
      pageFor: (k) => pageFor.get(k) ?? 1,
      broaden: false,
    });
    if (!more.ok) break;
    searches.push(...more.data.searches);
    pooled += more.data.pooled;
    hiddenByFilters += more.data.hiddenByFilters;
    for (const p of more.data.products) exclude.add(p.pid);
    products = [...products, ...inNiche(more.data.products)].sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
  }

  // Market Guard check on the best, then the top RETURNED.
  const checked = await applyMarketCheck(products, {
    top: MARKET_CHECK_COUNT,
    deadline: started + MARKET_DEADLINE_MS,
    adRatePct: defaults.adRatePct,
  });
  const shown = checked.products.slice(0, RETURNED);
  await markSeen(userId, niche.name, [
    ...shown.map((p) => ({ pid: p.pid, keyword: p.foundBy ?? "", outcome: "shown" as const })),
    ...checked.droppedPids.map((pid) => ({
      pid,
      keyword: products.find((p) => p.pid === pid)?.foundBy ?? "",
      outcome: "rejected" as const,
    })),
  ]);

  console.log(
    `[winning-agent] niche="${niche.name}" categories=${JSON.stringify(scope?.firstLevels ?? [])} keywords=${JSON.stringify(keywords)} seenBefore=${seen.size} offCategory=${offCategory} topUp=${topUp} fresh=${products.length} retries=${retries} shown=${shown.length} ms=${Date.now() - started}`,
  );
  return {
    ok: true,
    data: {
      keywords,
      categories: scope?.firstLevels ?? [],
      offCategory,
      keywordSource: suggestion.source,
      searches,
      pooled,
      hiddenByFilters,
      seenBefore: seen.size,
      retries,
      market: checked.summary,
      products: shown,
    },
  };
}
