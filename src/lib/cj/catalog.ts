import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { cjFetch, getCjAccessToken } from "@/lib/cj/client";
import { type CjProductFromApi, type CjVariantFromApi, mapCjProductToDraft, parseVariantKey } from "@/lib/cj/mapper";
import { rankByRelevance } from "@/lib/cj/relevance";
import { sanitizeCjDescription } from "@/lib/cj/sanitize";
import { cjProductUrl } from "@/lib/cj/urls";
import { priceForEbay } from "@/lib/pricing";
import { type MarketInfo, type WinningBreakdown, parseCjDate, winningScore } from "@/lib/winning-score";

/**
 * CJ sourcing for the dashboard: keyword search and one-click import into
 * catalog_products. CJ allows about 1 request per second, so every call made
 * here goes through one queue that spaces them out (per server instance).
 */

const CJ_GAP_MS = 1100;
/** Larger than one screen so the relevance filter still leaves plenty to show. */
const PAGE_SIZE = 60;
/** How many US-warehouse matches are checked to label a result "US". */
const US_LOOKUP_SIZE = 200;

let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCallAt + CJ_GAP_MS - Date.now();
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

type CjResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function cjGet(path: string, init?: RequestInit): Promise<CjResult<unknown>> {
  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "CJ sourcing is not configured (CJ_API_KEY is missing).", status: 503 };
  // Token lookups are cached (and CJ limits that endpoint separately), so only data calls are queued.
  const token = await getCjAccessToken(apiKey);
  if (!token.ok) return { ok: false, error: `Could not sign in to CJ: ${token.error}`, status: 502 };
  const body = (await throttled(() => cjFetch(path, token.token, init))) as {
    ok?: boolean;
    result?: boolean;
    code?: number;
    message?: string;
    error?: string;
    data?: unknown;
  };
  // cjFetch returns { ok: false, error } when CJ is unreachable; CJ itself answers { result, code, message, data }.
  if (body?.ok === false || body?.result === false || (typeof body?.code === "number" && body.code !== 200)) {
    return { ok: false, error: body?.message || body?.error || "CJ returned an error.", status: 502 };
  }
  return { ok: true, data: body?.data };
}

const num = (value: unknown) => {
  const match = typeof value === "number" ? [value] : String(value ?? "").match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return match.length ? Math.min(...match) : 0;
};
const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const cjExternalId = (pid: string) => `cj-${pid}`;

export type CjSearchItem = {
  pid: string;
  title: string;
  imageUrl: string | null;
  /** Lowest CJ price in USD (CJ sends ranges like "3.20 -- 5.10"). */
  price: number;
  /** CJ's own price text, kept for ranges. */
  priceLabel: string;
  /** How many CJ sellers have listed this product. */
  listedNum: number;
  category: string;
  /** "US" when CJ lists it in its US warehouse, "CN" otherwise; null if that lookup failed. */
  origin: "US" | "CN" | null;
  imported: boolean;
  /** When CJ added the product (ISO), if CJ says. */
  addedAt: string | null;
  /** Multi-keyword searches: the keyword that found it. */
  foundBy?: string;
};

export type CjSearchResult = {
  items: CjSearchItem[];
  page: number;
  pageSize: number;
  total: number;
  /** Results on this page dropped because their title shares no word with the search. */
  rejected: number;
};

/** Narrowing passed to CJ with the search (CJ's /product/list supports these). */
export type CjSearchFilters = {
  minPrice?: number;
  maxPrice?: number;
  minSellers?: number;
  maxSellers?: number;
};

type CjListData = { list?: Array<Record<string, unknown>>; total?: number | string } | null;

/**
 * One page of CJ results for a keyword: labelled US/CN, relevance-filtered,
 * `imported` left false (see markImported). Two CJ calls (results + a US
 * warehouse lookup), or one with usOnly, which asks CJ for US stock only.
 */
async function searchCjPage(
  keyword: string,
  page: number,
  pageSize: number,
  filters: CjSearchFilters & { usOnly?: boolean } = {},
): Promise<CjResult<{ items: CjSearchItem[]; total: number; rejected: number; words: string[] }>> {
  const q = encodeURIComponent(keyword);
  const narrow = new URLSearchParams();
  if (filters.minPrice != null) narrow.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) narrow.set("maxPrice", String(filters.maxPrice));
  if (filters.minSellers != null) narrow.set("minListedNum", String(filters.minSellers));
  if (filters.maxSellers != null) narrow.set("maxListedNum", String(filters.maxSellers));
  if (filters.usOnly) narrow.set("countryCode", "US");
  const extra = narrow.size ? `&${narrow}` : "";
  const listed = await cjGet(`/product/list?pageNum=${page}&pageSize=${pageSize}&productNameEn=${q}${extra}`);
  if (!listed.ok) return listed;
  const data = listed.data as CjListData;
  const rows = Array.isArray(data?.list) ? data.list : [];

  let usPids: Set<string> | null = null;
  if (filters.usOnly) {
    usPids = new Set(rows.map((r) => str(r.pid)).filter(Boolean));
  } else if (rows.length) {
    const us = await cjGet(`/product/list?pageNum=1&pageSize=${US_LOOKUP_SIZE}&productNameEn=${q}&countryCode=US`);
    if (us.ok) {
      const usRows = (us.data as CjListData)?.list;
      usPids = new Set((Array.isArray(usRows) ? usRows : []).map((r) => str(r.pid)).filter(Boolean));
    }
  }

  const items = rows
    .map((row): CjSearchItem | null => {
      const pid = str(row.pid);
      if (!pid) return null;
      const image = mapCjProductToDraft(row as CjProductFromApi).images[0] ?? null;
      return {
        pid,
        title: str(row.productNameEn) || "Untitled CJ product",
        imageUrl: image,
        price: num(row.sellPrice),
        priceLabel: String(row.sellPrice ?? ""),
        listedNum: Math.round(num(row.listedNum)),
        category: str(row.categoryName),
        origin: usPids ? (usPids.has(pid) ? "US" : "CN") : null,
        imported: false,
        addedAt: parseCjDate(row.createTime ?? row.createrTime ?? row.createDate)?.toISOString() ?? null,
      };
    })
    .filter((item): item is CjSearchItem => item !== null);

  const relevant = rankByRelevance(items, keyword, (item) => item.title);
  console.log(
    `[cj-search] q="${keyword}" page=${page} size=${pageSize} words=${JSON.stringify(relevant.words)} kept=${relevant.kept.length} rejected=${relevant.rejected}`,
  );
  return {
    ok: true,
    data: { items: relevant.kept, total: Math.round(num(data?.total)), rejected: relevant.rejected, words: relevant.words },
  };
}

/** Sets `imported` on items the seller already has in their catalog (one query). */
async function markImported(userId: number, items: CjSearchItem[]) {
  if (!items.length) return items;
  const existing = await db
    .select({ externalId: catalogProducts.externalId })
    .from(catalogProducts)
    .where(and(eq(catalogProducts.userId, userId), inArray(catalogProducts.externalId, items.map((i) => cjExternalId(i.pid)))));
  const importedIds = new Set(existing.map((r) => r.externalId));
  return items.map((item) => ({ ...item, imported: importedIds.has(cjExternalId(item.pid)) }));
}

/** The Source page's keyword search: one page of PAGE_SIZE results. */
export async function searchCjProducts(
  userId: number,
  keyword: string,
  page: number,
  filters: CjSearchFilters = {},
): Promise<CjResult<CjSearchResult>> {
  const result = await searchCjPage(keyword, page, PAGE_SIZE, filters);
  if (!result.ok) return result;
  return {
    ok: true,
    data: {
      items: await markImported(userId, result.data.items),
      page,
      pageSize: PAGE_SIZE,
      total: result.data.total,
      rejected: result.data.rejected,
    },
  };
}

/** CJ results asked for per keyword in a multi-keyword search. */
const MULTI_PAGE_SIZE = 100;
/** A keyword returning fewer relevant results than this is retried with a broader phrase. */
const BROADEN_BELOW = 25;
/** No broadening retries once a multi-keyword search has run this long (it must fit a 60 s request). */
const BROADEN_BUDGET_MS = 25_000;

export type KeywordSearchStat = {
  keyword: string;
  /** Relevant CJ results for this keyword (both queries, before de-duplication). */
  found: number;
  /** Of those, how many the seller hasn't been shown before (see `exclude`). */
  fresh?: number;
  /** CJ page searched (1 unless a retry went deeper). */
  page?: number;
  /** CJ's total results for the keyword, so a retry knows how deep it can go. */
  total?: number;
  /** The same for `broadenedTo`, which usually finds far more than a long keyword. */
  broadTotal?: number;
  /** The broader phrase also searched when the keyword alone found too little. */
  broadenedTo?: string;
  error?: string;
};

/**
 * The broader phrase for a long keyword: its last two words, which in English
 * product names are usually the product itself ("cordless electric spin
 * scrubber" → "spin scrubber"). Null when there is nothing to drop.
 */
export function broaderPhrase(keyword: string) {
  const words = keyword.trim().split(/\s+/);
  return words.length >= 3 ? words.slice(-2).join(" ") : null;
}

/**
 * Searches CJ for up to 5 keywords, one after another through the shared
 * 1.1 s queue: MULTI_PAGE_SIZE results each, plus one broader retry for a
 * keyword that finds fewer than BROADEN_BELOW. Results are pooled and
 * de-duplicated by PID (first keyword to find a product keeps it), then
 * capped at maxTotal. Fails only if every keyword's search failed.
 */
export async function searchCjKeywords(
  userId: number,
  keywords: string[],
  options: {
    filters?: CjSearchFilters & { usOnly?: boolean };
    maxTotal?: number;
    /** Product IDs to leave out (already shown to the seller); they don't count toward maxTotal. */
    exclude?: Set<string>;
    /** CJ page to search for each keyword (default 1). */
    pageFor?: (keyword: string) => number;
    /** Retry thin keywords with a broader phrase (default true). */
    broaden?: boolean;
  } = {},
): Promise<CjResult<{ items: CjSearchItem[]; searches: KeywordSearchStat[] }>> {
  const started = Date.now();
  const maxTotal = options.maxTotal ?? 200;
  const searches: KeywordSearchStat[] = [];
  const pool = new Map<string, CjSearchItem>();
  let lastError: { ok: false; error: string; status: number } | null = null;

  for (const keyword of keywords.slice(0, 5)) {
    const page = Math.max(1, Math.floor(options.pageFor?.(keyword) ?? 1));
    const stat: KeywordSearchStat = { keyword, found: 0, page };
    searches.push(stat);
    const first = await searchCjPage(keyword, page, MULTI_PAGE_SIZE, options.filters);
    if (!first.ok) {
      lastError = first;
      stat.error = first.error;
      continue;
    }
    stat.total = first.data.total;
    const found = [...first.data.items];
    const broader = broaderPhrase(keyword);
    if (
      options.broaden !== false &&
      found.length < BROADEN_BELOW &&
      broader &&
      Date.now() - started < BROADEN_BUDGET_MS
    ) {
      const second = await searchCjPage(broader, page, MULTI_PAGE_SIZE, options.filters);
      if (second.ok) {
        stat.broadenedTo = broader;
        stat.broadTotal = second.data.total;
        found.push(...second.data.items);
      }
    }
    stat.found = found.length;
    const fresh = options.exclude ? found.filter((item) => !options.exclude?.has(item.pid)) : found;
    stat.fresh = fresh.length;
    for (const item of fresh) if (!pool.has(item.pid)) pool.set(item.pid, { ...item, foundBy: keyword });
  }
  if (lastError && searches.every((s) => s.error)) return lastError;

  const items = await markImported(userId, [...pool.values()].slice(0, maxTotal));
  console.log(
    `[cj-multi-search] keywords=${JSON.stringify(keywords)} unique=${pool.size} returned=${items.length} ms=${Date.now() - started}`,
  );
  return { ok: true, data: { items, searches } };
}

/** A top-level CJ category and the lower-level category names under it. */
export type CjCategory = {
  name: string;
  subcategoryNames: string[];
  /**
   * Third-level category IDs (the only level CJ's product list filters by),
   * interleaved across the second-level groups so the first few span the
   * whole category.
   */
  subcategoryIds: string[];
};

const CATEGORY_TTL_MS = 24 * 60 * 60 * 1000;
/** One third-level CJ category with the names above it. */
type CjCategoryLeaf = { id: string; name: string; second: string; first: string };
let categoryCache: { at: number; categories: CjCategory[]; leaves: CjCategoryLeaf[] } | null = null;

type CjCategoryTree = Array<{
  categoryFirstName?: string;
  categoryFirstList?: Array<{
    categorySecondName?: string;
    categorySecondList?: Array<{ categoryId?: string; categoryName?: string }>;
  }>;
}>;

/**
 * CJ's top-level categories, cached per server instance for a day. CJ only
 * gives IDs for third-level categories, so search results (which carry the
 * third-level categoryName) are matched against these name lists.
 */
export async function getCjCategories(): Promise<CjResult<CjCategory[]>> {
  if (categoryCache && Date.now() - categoryCache.at < CATEGORY_TTL_MS) return { ok: true, data: categoryCache.categories };
  const res = await cjGet("/product/getCategory");
  if (!res.ok) return res;
  const tree = Array.isArray(res.data) ? (res.data as CjCategoryTree) : [];
  const leaves: CjCategoryLeaf[] = [];
  for (const first of tree) {
    for (const second of first.categoryFirstList ?? []) {
      for (const third of second.categorySecondList ?? []) {
        if (!str(third.categoryId)) continue;
        leaves.push({
          id: str(third.categoryId),
          name: str(third.categoryName),
          second: str(second.categorySecondName),
          first: str(first.categoryFirstName),
        });
      }
    }
  }
  const categories = tree
    .map((first): CjCategory => {
      const names = new Set<string>();
      const groups: string[][] = [];
      for (const second of first.categoryFirstList ?? []) {
        if (str(second.categorySecondName)) names.add(str(second.categorySecondName));
        const ids: string[] = [];
        for (const third of second.categorySecondList ?? []) {
          if (str(third.categoryName)) names.add(str(third.categoryName));
          if (str(third.categoryId)) ids.push(str(third.categoryId));
        }
        if (ids.length) groups.push(ids);
      }
      const subcategoryIds: string[] = [];
      for (let i = 0; groups.some((g) => i < g.length); i += 1) {
        for (const group of groups) if (i < group.length) subcategoryIds.push(group[i]);
      }
      return { name: str(first.categoryFirstName), subcategoryNames: [...names], subcategoryIds };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (categories.length) categoryCache = { at: Date.now(), categories, leaves };
  return { ok: true, data: categories };
}

/** The CJ categories a niche covers: third-level IDs (what CJ's product list filters by) and their names. */
export type CjCategoryScope = { ids: string[]; names: Set<string>; firstLevels: string[] };

/**
 * Maps a niche to CJ's own categories: every third-level category whose name,
 * or the second- or top-level name above it, matches `match` (see NICHES in
 * src/lib/niches.ts). IDs are interleaved across top-level categories so the
 * first few span all of them. Null when CJ's category list can't be loaded or
 * nothing matches.
 */
export async function cjCategoryScope(match: RegExp): Promise<CjCategoryScope | null> {
  const loaded = await getCjCategories();
  if (!loaded.ok || !categoryCache) return null;
  const hits = categoryCache.leaves.filter((leaf) => match.test(leaf.name) || match.test(leaf.second) || match.test(leaf.first));
  if (!hits.length) return null;
  const byFirst = new Map<string, CjCategoryLeaf[]>();
  for (const leaf of hits) byFirst.set(leaf.first, [...(byFirst.get(leaf.first) ?? []), leaf]);
  const groups = [...byFirst.values()];
  const ids: string[] = [];
  for (let i = 0; groups.some((g) => i < g.length); i += 1) {
    for (const group of groups) if (i < group.length) ids.push(group[i].id);
  }
  return { ids, names: new Set(hits.map((l) => l.name.toLowerCase()).filter(Boolean)), firstLevels: [...byFirst.keys()] };
}

/** Whether a CJ product's (third-level) category name falls inside a niche's scope. */
export function inCategoryScope(category: string, scope: CjCategoryScope, match: RegExp) {
  const name = category.trim().toLowerCase();
  return Boolean(name) && (scope.names.has(name) || match.test(category));
}

/** CJ's "listed by N sellers" as our competition level. */
function competitionFromListed(listedNum: number): "low" | "medium" | "high" {
  if (listedNum > 500) return "high";
  if (listedNum > 100) return "medium";
  return "low";
}

/**
 * Fetches a CJ product with its variants and upserts it into `userId`'s catalog
 * (one row per seller per product; null writes a shared, ownerless row).
 */
export async function importCjProduct(
  pid: string,
  userId: number | null,
): Promise<CjResult<{ id: number; externalId: string; created: boolean }>> {
  const detail = await cjGet(`/product/query?pid=${encodeURIComponent(pid)}`);
  if (!detail.ok) return detail;
  const product = detail.data as CjProductFromApi | null;
  if (!product || typeof product !== "object" || !str(product.pid)) {
    return { ok: false, error: "CJ has no product with that id.", status: 404 };
  }
  if (!Array.isArray(product.variants) || !product.variants.length) {
    const variants = await cjGet(`/product/variant/query?pid=${encodeURIComponent(pid)}`);
    if (variants.ok && Array.isArray(variants.data)) product.variants = variants.data as CjVariantFromApi[];
  }

  const draft = mapCjProductToDraft(product);
  if (!draft.title) return { ok: false, error: "CJ returned this product without an English title.", status: 422 };
  if (draft.supplierPrice <= 0) return { ok: false, error: "CJ returned this product without a price.", status: 422 };

  // Real shipping to the US for the cheapest variant (the one supplierPrice is). No quote, no import:
  // a product priced without its real shipping can be listed at a loss.
  const quoteSku = [...draft.variants].sort((a, b) => (a.price || Infinity) - (b.price || Infinity))[0]?.sku ?? null;
  const quote = await cjShippingCost(draft.externalId, quoteSku);
  if (!quote.ok) return quote;
  const shipping = quote.data;
  const suggested = priceForEbay(draft.supplierPrice, shipping);
  const externalId = cjExternalId(draft.externalId);
  const values = {
    userId,
    externalId,
    source: "cj",
    title: draft.title,
    category: draft.category || "General",
    supplier: "cj",
    supplierUrl: cjProductUrl(draft.externalId, draft.title),
    imageUrl: draft.images[0] ?? null,
    images: draft.images,
    variants: draft.variants,
    details: draft.facts,
    supplierPrice: draft.supplierPrice.toFixed(2),
    suggestedPrice: suggested.toFixed(2),
    shippingCost: shipping.toFixed(2),
    shippingQuotedAt: new Date(),
    competition: competitionFromListed(draft.listedNum),
  };
  const [row] = await db
    .insert(catalogProducts)
    .values(values)
    // Matches the partial unique indexes on catalog_products (see schema.ts).
    .onConflictDoUpdate(
      userId == null
        ? { target: catalogProducts.externalId, targetWhere: sql`user_id is null`, set: { ...values, refreshedAt: new Date() } }
        : {
            target: [catalogProducts.userId, catalogProducts.externalId],
            targetWhere: sql`user_id is not null`,
            set: { ...values, refreshedAt: new Date() },
          },
    )
    // xmax = 0 only on a freshly inserted row.
    .returning({ id: catalogProducts.id, created: sql<boolean>`(xmax = 0)` });
  return { ok: true, data: { id: row.id, externalId, created: row.created } };
}

export type CjDetailVariant = {
  vid: string;
  sku: string;
  key: string;
  color: string | null;
  size: string | null;
  price: number | null;
  weightGrams: number | null;
  /** Length × width × height as CJ sends them (assumed millimetres). */
  dimensions: { length: number; width: number; height: number } | null;
  barcode: string;
  image: string | null;
};

export type CjProductDetail = {
  pid: string;
  /** CJ's original-language name (usually Chinese). */
  productName: string;
  productNameEn: string;
  images: string[];
  /** Sanitized: plain formatting tags only, no attributes, links or images. */
  descriptionHtml: string;
  priceMin: number;
  priceMax: number;
  priceLabel: string;
  weightMinGrams: number;
  weightMaxGrams: number;
  category: string;
  productSku: string;
  listedNum: number;
  variants: CjDetailVariant[];
};

const allNumbers = (value: unknown) =>
  typeof value === "number" ? [value] : (String(value ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const optionalNum = (value: unknown) => {
  const n = allNumbers(value);
  return n.length ? Math.min(...n) : null;
};

/** CJ's productName is sometimes a JSON-encoded array of names. */
function nameText(value: unknown) {
  const raw = str(value);
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter((v) => typeof v === "string" && v.trim()).join(" / ");
    } catch {
      // not JSON; use as-is
    }
  }
  return raw;
}

/** Full product (detail + variants) for the sourcing modal. Two CJ calls. */
export async function getCjProductDetail(pid: string): Promise<CjResult<CjProductDetail>> {
  const detail = await cjGet(`/product/query?pid=${encodeURIComponent(pid)}`);
  if (!detail.ok) return detail;
  const product = detail.data as CjProductFromApi | null;
  if (!product || typeof product !== "object" || !str(product.pid)) {
    return { ok: false, error: "CJ has no product with that id.", status: 404 };
  }
  const variantsRes = await cjGet(`/product/variant/query?pid=${encodeURIComponent(pid)}`);
  const rawVariants: CjVariantFromApi[] =
    variantsRes.ok && Array.isArray(variantsRes.data) && variantsRes.data.length
      ? (variantsRes.data as CjVariantFromApi[])
      : Array.isArray(product.variants)
        ? product.variants
        : [];

  const draft = mapCjProductToDraft({ ...product, variants: [] });
  const prices = allNumbers(product.sellPrice);
  const weights = allNumbers(product.productWeight);

  const variants = rawVariants.map((v): CjDetailVariant => {
    const parsed = parseVariantKey(v.variantKey);
    const length = optionalNum(v.variantLength);
    const width = optionalNum(v.variantWidth);
    const height = optionalNum(v.variantHeight);
    return {
      vid: str(v.vid),
      sku: str(v.variantSku),
      key: str(v.variantKey),
      color: parsed?.color ?? null,
      size: parsed?.size ?? null,
      price: optionalNum(v.variantSellPrice),
      weightGrams: optionalNum(v.variantWeight),
      dimensions: length && width && height ? { length, width, height } : null,
      barcode: str(v.barcode),
      image: str(v.variantImage) || null,
    };
  });

  return {
    ok: true,
    data: {
      pid: draft.externalId,
      productName: nameText(product.productName),
      productNameEn: draft.title,
      images: draft.images,
      descriptionHtml: sanitizeCjDescription(product.description),
      priceMin: prices.length ? Math.min(...prices) : 0,
      priceMax: prices.length ? Math.max(...prices) : 0,
      priceLabel: String(product.sellPrice ?? ""),
      weightMinGrams: weights.length ? Math.min(...weights) : 0,
      weightMaxGrams: weights.length ? Math.max(...weights) : 0,
      category: draft.category,
      productSku: draft.supplierSku,
      listedNum: draft.listedNum,
      variants,
    },
  };
}

export type WinningFilters = {
  /** Top-level CJ category name (from getCjCategories); blank = any. */
  category?: string;
  /** Third-level CJ category IDs to query instead of `category` (e.g. a niche's, from cjCategoryScope). */
  categoryIds?: string[];
  /** CJ product IDs to leave out (e.g. ones the seller dismissed). */
  exclude?: Set<string>;
  minPrice?: number;
  maxPrice?: number;
  /** Minimum net profit in USD at the suggested eBay price. */
  minProfit?: number;
  maxSellers?: number;
  usOnly?: boolean;
  limit: number;
};

export type WinningProduct = CjSearchItem & Omit<WinningBreakdown, "parts"> & {
  scoreParts: WinningBreakdown["parts"];
  /** When CJ added the product (ISO), if CJ says. */
  addedAt: string | null;
  /**
   * eBay market check (see src/lib/market-check.ts): undefined when it wasn't
   * checked, null when eBay had too few matching listings to judge.
   */
  market?: MarketInfo | null;
};

/** CJ rows examined per feed request (one page; CJ's max page size). */
const FEED_POOL = 200;
/**
 * With a category, CJ is asked for this many of its third-level categories
 * (1–2 calls each, ~1.1 s apart), CATEGORY_POOL rows apiece.
 */
const CATEGORY_QUERIES = 5;
const CATEGORY_POOL = 60;

/**
 * The Winning Products feed: CJ products (no keyword) narrowed by price and
 * seller count at CJ, then scored with winningScore() and filtered by profit
 * and warehouse here. Without a category: two CJ calls (all + US warehouse),
 * or one with usOnly. With a category, CJ is queried by up to CATEGORY_QUERIES
 * of its third-level category IDs (the same one or two calls each), so the
 * batch is fresh products from that category, not a filtered general feed.
 */
export async function getWinningProducts(userId: number, filters: WinningFilters): Promise<CjResult<WinningProduct[]>> {
  const narrow = new URLSearchParams({ pageNum: "1" });
  if (filters.minPrice != null) narrow.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) narrow.set("maxPrice", String(filters.maxPrice));
  if (filters.maxSellers != null) narrow.set("maxListedNum", String(filters.maxSellers));

  // Each entry is one CJ query: no category (the general feed), or one of the
  // chosen category's third-level IDs, so CJ returns products from that category.
  let scopes: Array<{ categoryId?: string; pageSize: number }> = [{ pageSize: FEED_POOL }];
  if (filters.categoryIds?.length) {
    scopes = filters.categoryIds.slice(0, CATEGORY_QUERIES).map((categoryId) => ({ categoryId, pageSize: CATEGORY_POOL }));
  } else if (filters.category) {
    const categories = await getCjCategories();
    if (!categories.ok) return categories;
    const selected = categories.data.find((c) => c.name === filters.category);
    if (!selected?.subcategoryIds.length) {
      return { ok: false, error: `CJ has no category called "${filters.category}". Pick another category.`, status: 400 };
    }
    scopes = selected.subcategoryIds.slice(0, CATEGORY_QUERIES).map((categoryId) => ({ categoryId, pageSize: CATEGORY_POOL }));
  }

  const rows: Array<Record<string, unknown>> = [];
  const usPidSet = new Set<string>();
  let usKnown = true;
  for (const scope of scopes) {
    const params = new URLSearchParams(narrow);
    params.set("pageSize", String(scope.pageSize));
    if (scope.categoryId) params.set("categoryId", scope.categoryId);

    const us = await cjGet(`/product/list?${params}&countryCode=US`);
    const usRows = us.ok && Array.isArray((us.data as CjListData)?.list) ? ((us.data as CjListData)?.list ?? []) : [];
    if (us.ok) {
      for (const r of usRows) if (str(r.pid)) usPidSet.add(str(r.pid));
    } else {
      usKnown = false;
    }

    if (filters.usOnly) {
      if (!us.ok) return us;
      rows.push(...usRows);
      continue;
    }
    const all = await cjGet(`/product/list?${params}`);
    if (!all.ok) return all;
    const allRows = (all.data as CjListData)?.list;
    rows.push(...(Array.isArray(allRows) ? allRows : []));
  }
  const usPids = usKnown ? usPidSet : null;

  const pids = rows.map((r) => str(r.pid)).filter(Boolean);
  const existing = pids.length
    ? await db
        .select({ externalId: catalogProducts.externalId })
        .from(catalogProducts)
        .where(and(eq(catalogProducts.userId, userId), inArray(catalogProducts.externalId, pids.map(cjExternalId))))
    : [];
  const importedIds = new Set(existing.map((r) => r.externalId));

  const now = Date.now();
  const seen = new Set<string>();
  const products: WinningProduct[] = [];
  for (const row of rows) {
    const pid = str(row.pid);
    const cost = num(row.sellPrice);
    if (!pid || seen.has(pid) || cost <= 0 || filters.exclude?.has(pid)) continue;
    seen.add(pid);
    const category = str(row.categoryName);
    const origin: CjSearchItem["origin"] = usPids ? (usPids.has(pid) ? "US" : "CN") : null;
    if (filters.usOnly && origin !== "US") continue;
    const listedNum = Math.round(num(row.listedNum));
    if (filters.maxSellers != null && listedNum > filters.maxSellers) continue;
    const added = parseCjDate(row.createTime ?? row.createrTime ?? row.createDate);
    const { parts, ...score } = winningScore({ cost, listedNum, origin, createdAt: added }, now);
    if (filters.minProfit != null && score.profit < filters.minProfit) continue;
    products.push({
      pid,
      title: str(row.productNameEn) || "Untitled CJ product",
      imageUrl: mapCjProductToDraft(row as CjProductFromApi).images[0] ?? null,
      price: cost,
      priceLabel: String(row.sellPrice ?? ""),
      listedNum,
      category,
      origin,
      imported: importedIds.has(cjExternalId(pid)),
      ...score,
      scoreParts: parts,
      addedAt: added ? added.toISOString() : null,
    });
  }

  products.sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
  console.log(
    `[cj-winning] queries=${scopes.length} pool=${rows.length} scored=${products.length} us=${usPids ? usPids.size : "n/a"} filters=${JSON.stringify({ ...filters, exclude: filters.exclude?.size })}`,
  );
  return { ok: true, data: products.slice(0, filters.limit) };
}

/** Most products pooled from a keyword run before scoring (5 keywords × up to 2 × 100 results). */
const KEYWORD_POOL_MAX = 1000;

export type KeywordWinners = {
  products: WinningProduct[];
  searches: KeywordSearchStat[];
  /** Unique CJ products found across all keywords, before the page's filters. */
  pooled: number;
  /** Of those, how many the page's filters (profit, sellers, US warehouse) hid. */
  hiddenByFilters: number;
};

/**
 * Winning products for a set of search keywords: searchCjKeywords pools and
 * de-duplicates every keyword's CJ results, then each is scored with
 * winningScore() and filtered like the feed; the best `limit` are returned.
 * CJ is asked for the price and seller ranges up front, so the 100 results
 * per keyword are ones the filters can keep.
 */
export async function getKeywordWinners(
  userId: number,
  keywords: string[],
  filters: Omit<WinningFilters, "category" | "categoryIds" | "exclude">,
  search: Pick<NonNullable<Parameters<typeof searchCjKeywords>[2]>, "exclude" | "pageFor" | "broaden"> = {},
): Promise<CjResult<KeywordWinners>> {
  const found = await searchCjKeywords(userId, keywords, {
    filters: { minPrice: filters.minPrice, maxPrice: filters.maxPrice, maxSellers: filters.maxSellers, usOnly: filters.usOnly },
    maxTotal: KEYWORD_POOL_MAX,
    ...search,
  });
  if (!found.ok) return found;
  const pool = found.data.items;

  const now = Date.now();
  const products: WinningProduct[] = [];
  for (const item of pool) {
    if (item.price <= 0) continue;
    if (filters.usOnly && item.origin !== "US") continue;
    if (filters.maxSellers != null && item.listedNum > filters.maxSellers) continue;
    const added = item.addedAt ? new Date(item.addedAt) : null;
    const { parts, ...score } = winningScore(
      { cost: item.price, listedNum: item.listedNum, origin: item.origin, createdAt: added },
      now,
    );
    if (filters.minProfit != null && score.profit < filters.minProfit) continue;
    products.push({ ...item, ...score, scoreParts: parts });
  }

  products.sort((a, b) => b.winningScore - a.winningScore || b.profit - a.profit);
  console.log(
    `[cj-keyword-winners] keywords=${JSON.stringify(keywords)} pool=${pool.length} scored=${products.length} filters=${JSON.stringify(filters)}`,
  );
  return {
    ok: true,
    data: {
      products: products.slice(0, filters.limit),
      searches: found.data.searches,
      pooled: pool.length,
      hiddenByFilters: pool.length - products.length,
    },
  };
}

/** One CJ shipping method to the US for a product. */
export type CjShippingOption = {
  /** CJ's method name, e.g. "CJPacket Ordinary". */
  method: string;
  /** USD, for one unit. */
  price: number;
  /** CJ's delivery estimate in days, e.g. "7-12"; empty when CJ gives none. */
  days: string;
  /** Warehouse it ships from: CJ's China warehouses or its US warehouse. */
  from: "CN" | "US";
};

export type CjShippingQuote = {
  /** The variant quoted (CJ prices shipping per variant, by its weight). */
  variant: string;
  /** Cheapest first. Empty when CJ has no method to the US for it. */
  options: CjShippingOption[];
};

const SHIPPING_TTL_MS = 6 * 60 * 60 * 1000;
const shippingCache = new Map<string, { at: number; quote: CjShippingQuote }>();

type CjFreight = Array<{ logisticName?: unknown; logisticPrice?: unknown; logisticAging?: unknown }>;

/** True when CJ actually stated a price (0 included), not left it out or blank. */
const hasPrice = (value: unknown) =>
  (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && /\d/.test(value));

/**
 * CJ's real shipping cost to the US for one unit of a product, from its
 * freight calculator (POST /logistic/freightCalculate), from both its China
 * and US warehouses (the US one only answers for products it stocks). CJ
 * quotes by variant id, which the catalog doesn't keep, so the variant list
 * is fetched first and `sku` (else the first variant) picks the one quoted.
 * Three CJ calls through the shared 1.1 s queue; cached 6 h per server instance.
 */
export async function getCjShipping(pid: string, sku?: string | null): Promise<CjResult<CjShippingQuote>> {
  const key = `${pid}:${sku ?? ""}`;
  const hit = shippingCache.get(key);
  if (hit && Date.now() - hit.at < SHIPPING_TTL_MS) return { ok: true, data: hit.quote };

  const variants = await cjGet(`/product/variant/query?pid=${encodeURIComponent(pid)}`);
  if (!variants.ok) return variants;
  const list = (Array.isArray(variants.data) ? variants.data : []) as CjVariantFromApi[];
  const variant = list.find((v) => sku && str(v.variantSku) === sku) ?? list.find((v) => str(v.vid));
  if (!variant?.vid) return { ok: false, error: "CJ has no variants for this product to quote shipping on.", status: 404 };

  const options: CjShippingOption[] = [];
  let lastError: { ok: false; error: string; status: number } | null = null;
  /** CJ's raw answer per warehouse, logged when nothing usable came back. */
  const raw: Record<string, unknown> = {};
  for (const from of ["CN", "US"] as const) {
    const res = await cjGet("/logistic/freightCalculate", {
      method: "POST",
      body: JSON.stringify({ startCountryCode: from, endCountryCode: "US", products: [{ quantity: 1, vid: variant.vid }] }),
    });
    raw[from] = res.ok ? res.data : { error: res.error };
    if (!res.ok) {
      lastError = res;
      continue;
    }
    for (const row of (Array.isArray(res.data) ? res.data : []) as CjFreight) {
      // A stated price of 0 is free shipping (common from CJ's US warehouse) and counts;
      // a missing or unreadable price doesn't, so a gap in CJ's answer is never taken as free.
      if (!hasPrice(row.logisticPrice)) continue;
      const price = num(row.logisticPrice);
      if (price >= 0) options.push({ method: str(row.logisticName) || "CJ shipping", price: Math.round(price * 100) / 100, days: String(row.logisticAging ?? "").trim(), from });
    }
  }
  if (!options.length) {
    console.warn(`[cj-shipping] pid=${pid} vid=${variant.vid}: no usable shipping option. CJ said: ${JSON.stringify(raw).slice(0, 2000)}`);
  }
  // Both warehouses failing is an error; one failing (usually: not stocked in the US) isn't.
  if (!options.length && lastError) return lastError;
  options.sort((a, b) => a.price - b.price);
  const quote = { variant: str(variant.variantNameEn) || str(variant.variantKey) || str(variant.variantSku), options };
  shippingCache.set(key, { at: Date.now(), quote });
  console.log(`[cj-shipping] pid=${pid} vid=${variant.vid} options=${options.length} cheapest=${options[0]?.price ?? "none"}`);
  return { ok: true, data: quote };
}

/**
 * The real shipping cost a product is priced with: CJ's cheapest method to the
 * US for one unit of the variant `sku` (else the first), from getCjShipping.
 * An error (with a message for the seller) when CJ can't quote it or has no
 * way to ship it to the US: callers must not fall back to a guess.
 */
export async function cjShippingCost(pid: string, sku?: string | null): Promise<CjResult<number>> {
  const quote = await getCjShipping(pid, sku);
  if (!quote.ok) {
    return { ok: false, error: `Couldn't get CJ's shipping price (${quote.error}), so it can't be priced safely. Try again in a moment.`, status: quote.status };
  }
  const cheapest = quote.data.options[0];
  if (!cheapest) return { ok: false, error: "CJ has no shipping method to the US for this product.", status: 422 };
  return { ok: true, data: cheapest.price };
}

/**
 * Re-quotes a catalog product's shipping with CJ and saves it (shippingCost,
 * the suggested price built on it, shippingQuotedAt), for products imported
 * before real quotes were stored. Returns the new shipping cost.
 */
export async function refreshCjShipping(
  userId: number,
  product: { externalId: string; supplierPrice: number; variants: Array<{ sku: string; price: number }> },
): Promise<CjResult<{ shipping: number; suggested: number }>> {
  const pid = product.externalId.startsWith("cj-") ? product.externalId.slice(3) : "";
  if (!pid) return { ok: false, error: "Not a CJ product, so CJ can't quote its shipping.", status: 422 };
  const sku = [...product.variants].sort((a, b) => (a.price || Infinity) - (b.price || Infinity))[0]?.sku ?? null;
  const quote = await cjShippingCost(pid, sku);
  if (!quote.ok) return quote;
  const suggested = priceForEbay(product.supplierPrice, quote.data);
  await db
    .update(catalogProducts)
    .set({ shippingCost: quote.data.toFixed(2), suggestedPrice: suggested.toFixed(2), shippingQuotedAt: new Date() })
    .where(and(eq(catalogProducts.userId, userId), eq(catalogProducts.externalId, product.externalId)));
  return { ok: true, data: { shipping: quote.data, suggested } };
}
