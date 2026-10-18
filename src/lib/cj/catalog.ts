import "server-only";

import { inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { cjFetch, getCjAccessToken } from "@/lib/cj/client";
import { type CjProductFromApi, type CjVariantFromApi, mapCjProductToDraft, parseVariantKey } from "@/lib/cj/mapper";
import { rankByRelevance } from "@/lib/cj/relevance";
import { sanitizeCjDescription } from "@/lib/cj/sanitize";
import { priceForEbay } from "@/lib/pricing";
import { type WinningBreakdown, parseCjDate, winningScore } from "@/lib/winning-score";

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

async function cjGet(path: string): Promise<CjResult<unknown>> {
  const apiKey = process.env.CJ_API_KEY?.trim();
  if (!apiKey) return { ok: false, error: "CJ sourcing is not configured (CJ_API_KEY is missing).", status: 503 };
  // Token lookups are cached (and CJ limits that endpoint separately), so only data calls are queued.
  const token = await getCjAccessToken(apiKey);
  if (!token.ok) return { ok: false, error: `Could not sign in to CJ: ${token.error}`, status: 502 };
  const body = (await throttled(() => cjFetch(path, token.token))) as {
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

export async function searchCjProducts(
  keyword: string,
  page: number,
  filters: CjSearchFilters = {},
): Promise<CjResult<CjSearchResult>> {
  const q = encodeURIComponent(keyword);
  const narrow = new URLSearchParams();
  if (filters.minPrice != null) narrow.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) narrow.set("maxPrice", String(filters.maxPrice));
  if (filters.minSellers != null) narrow.set("minListedNum", String(filters.minSellers));
  if (filters.maxSellers != null) narrow.set("maxListedNum", String(filters.maxSellers));
  const extra = narrow.size ? `&${narrow}` : "";
  const listed = await cjGet(`/product/list?pageNum=${page}&pageSize=${PAGE_SIZE}&productNameEn=${q}${extra}`);
  if (!listed.ok) return listed;
  const data = listed.data as CjListData;
  const rows = Array.isArray(data?.list) ? data.list : [];

  let usPids: Set<string> | null = null;
  if (rows.length) {
    const us = await cjGet(`/product/list?pageNum=1&pageSize=${US_LOOKUP_SIZE}&productNameEn=${q}&countryCode=US`);
    if (us.ok) {
      const usRows = (us.data as CjListData)?.list;
      usPids = new Set((Array.isArray(usRows) ? usRows : []).map((r) => str(r.pid)).filter(Boolean));
    }
  }

  const pids = rows.map((r) => str(r.pid)).filter(Boolean);
  const existing = pids.length
    ? await db
        .select({ externalId: catalogProducts.externalId })
        .from(catalogProducts)
        .where(inArray(catalogProducts.externalId, pids.map(cjExternalId)))
    : [];
  const importedIds = new Set(existing.map((r) => r.externalId));

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
        imported: importedIds.has(cjExternalId(pid)),
      };
    })
    .filter((item): item is CjSearchItem => item !== null);

  const relevant = rankByRelevance(items, keyword, (item) => item.title);
  console.log(
    `[cj-search] q="${keyword}" page=${page} words=${JSON.stringify(relevant.words)} kept=${relevant.kept.length} rejected=${relevant.rejected}`,
  );

  return {
    ok: true,
    data: {
      items: relevant.kept,
      page,
      pageSize: PAGE_SIZE,
      total: Math.round(num(data?.total)),
      rejected: relevant.rejected,
    },
  };
}

/** A top-level CJ category and the lower-level category names under it. */
export type CjCategory = { name: string; subcategoryNames: string[] };

const CATEGORY_TTL_MS = 24 * 60 * 60 * 1000;
let categoryCache: { at: number; categories: CjCategory[] } | null = null;

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
  const categories = tree
    .map((first): CjCategory => {
      const names = new Set<string>();
      for (const second of first.categoryFirstList ?? []) {
        if (str(second.categorySecondName)) names.add(str(second.categorySecondName));
        for (const third of second.categorySecondList ?? []) if (str(third.categoryName)) names.add(str(third.categoryName));
      }
      return { name: str(first.categoryFirstName), subcategoryNames: [...names] };
    })
    .filter((c) => c.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (categories.length) categoryCache = { at: Date.now(), categories };
  return { ok: true, data: categories };
}

/** CJ's "listed by N sellers" as our competition level. */
function competitionFromListed(listedNum: number): "low" | "medium" | "high" {
  if (listedNum > 500) return "high";
  if (listedNum > 100) return "medium";
  return "low";
}

/** Fetches a CJ product with its variants and upserts it into catalog_products. */
export async function importCjProduct(pid: string): Promise<CjResult<{ id: number; externalId: string; created: boolean }>> {
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

  const { shipping, suggested } = priceForEbay(draft.supplierPrice);
  const externalId = cjExternalId(draft.externalId);
  const values = {
    externalId,
    source: "cj",
    title: draft.title,
    category: draft.category || "General",
    supplier: "cj",
    imageUrl: draft.images[0] ?? null,
    images: draft.images,
    variants: draft.variants,
    details: draft.facts,
    supplierPrice: draft.supplierPrice.toFixed(2),
    suggestedPrice: suggested.toFixed(2),
    shippingCost: shipping.toFixed(2),
    competition: competitionFromListed(draft.listedNum),
  };
  const [row] = await db
    .insert(catalogProducts)
    .values(values)
    .onConflictDoUpdate({
      target: catalogProducts.externalId,
      set: { ...values, refreshedAt: new Date() },
    })
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
};

/** CJ rows examined per feed request (one page; CJ's max page size). */
const FEED_POOL = 200;

/**
 * The Winning Products feed: CJ products (no keyword) narrowed by price and
 * seller count at CJ, then scored with winningScore() and filtered by
 * category, profit and warehouse here. Two CJ calls (all + US warehouse), or
 * one with usOnly.
 */
export async function getWinningProducts(filters: WinningFilters): Promise<CjResult<WinningProduct[]>> {
  const narrow = new URLSearchParams({ pageNum: "1", pageSize: String(FEED_POOL) });
  if (filters.minPrice != null) narrow.set("minPrice", String(filters.minPrice));
  if (filters.maxPrice != null) narrow.set("maxPrice", String(filters.maxPrice));
  if (filters.maxSellers != null) narrow.set("maxListedNum", String(filters.maxSellers));

  const us = await cjGet(`/product/list?${narrow}&countryCode=US`);
  const usRows = us.ok && Array.isArray((us.data as CjListData)?.list) ? ((us.data as CjListData)?.list ?? []) : [];
  const usPids = us.ok ? new Set(usRows.map((r) => str(r.pid)).filter(Boolean)) : null;

  let rows = usRows;
  if (!filters.usOnly) {
    const all = await cjGet(`/product/list?${narrow}`);
    if (!all.ok) return all;
    const allRows = (all.data as CjListData)?.list;
    rows = Array.isArray(allRows) ? allRows : [];
  } else if (!us.ok) {
    return us;
  }

  let categoryNames: Set<string> | null = null;
  if (filters.category) {
    const categories = await getCjCategories();
    const selected = categories.ok ? categories.data.find((c) => c.name === filters.category) : undefined;
    categoryNames = new Set([filters.category, ...(selected?.subcategoryNames ?? [])].map((n) => n.toLowerCase()));
  }

  const pids = rows.map((r) => str(r.pid)).filter(Boolean);
  const existing = pids.length
    ? await db
        .select({ externalId: catalogProducts.externalId })
        .from(catalogProducts)
        .where(inArray(catalogProducts.externalId, pids.map(cjExternalId)))
    : [];
  const importedIds = new Set(existing.map((r) => r.externalId));

  const now = Date.now();
  const seen = new Set<string>();
  const products: WinningProduct[] = [];
  for (const row of rows) {
    const pid = str(row.pid);
    const cost = num(row.sellPrice);
    if (!pid || seen.has(pid) || cost <= 0) continue;
    seen.add(pid);
    const category = str(row.categoryName);
    if (categoryNames && !categoryNames.has(category.toLowerCase())) continue;
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
    `[cj-winning] pool=${rows.length} scored=${products.length} us=${usPids ? usPids.size : "n/a"} filters=${JSON.stringify(filters)}`,
  );
  return { ok: true, data: products.slice(0, filters.limit) };
}
