import "server-only";

import { inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { cjFetch, getCjAccessToken } from "@/lib/cj/client";
import { type CjProductFromApi, type CjVariantFromApi, mapCjProductToDraft } from "@/lib/cj/mapper";
import { priceForEbay } from "@/lib/pricing";

/**
 * CJ sourcing for the dashboard: keyword search and one-click import into
 * catalog_products. CJ allows about 1 request per second, so every call made
 * here goes through one queue that spaces them out (per server instance).
 */

const CJ_GAP_MS = 1100;
const PAGE_SIZE = 24;
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

export type CjSearchResult = { items: CjSearchItem[]; page: number; pageSize: number; total: number };

type CjListData = { list?: Array<Record<string, unknown>>; total?: number | string } | null;

export async function searchCjProducts(keyword: string, page: number): Promise<CjResult<CjSearchResult>> {
  const q = encodeURIComponent(keyword);
  const listed = await cjGet(`/product/list?pageNum=${page}&pageSize=${PAGE_SIZE}&productNameEn=${q}`);
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

  return { ok: true, data: { items, page, pageSize: PAGE_SIZE, total: Math.round(num(data?.total)) } };
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
