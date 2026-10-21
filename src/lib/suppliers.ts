import "server-only";

import { db } from "@/db";
import { type CatalogVariant, catalogProducts } from "@/db/schema";
import type { ProductFacts } from "@/lib/cj/facts";
import { cjPidOf, cjProductUrl } from "@/lib/cj/urls";
import { competitionFor, netProfitFor, priceForEbay } from "@/lib/pricing";
import { SAMPLE_SHIPPING, SAMPLE_SUPPLIER, STARTER_ROWS, starterImageUrl } from "@/lib/starter-catalog";
import { screenVero, stricterRisk } from "@/lib/vero";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type SupplierProduct = {
  externalId: string;
  source: string;
  title: string;
  category: string;
  supplier: string;
  supplierUrl: string | null;
  imageUrl: string | null;
  /** All product images, primary first; empty when only `imageUrl` is known. */
  images: string[];
  /** Real supplier variants; empty when the product has no stored variants. */
  variants: CatalogVariant[];
  /** Supplier facts for listing copy; null when the supplier sent none. */
  details: ProductFacts | null;
  supplierPrice: number;
  suggestedPrice: number;
  shippingCost: number;
  /** True when shippingCost is CJ's real quote; false for old flat estimates (re-quoted before listing). */
  shippingQuoted: boolean;
  monthlySales: number;
  competition: "low" | "medium" | "high";
  veroRisk: "low" | "medium" | "high";
};

export function netProfit(product: Pick<SupplierProduct, "supplierPrice" | "suggestedPrice" | "shippingCost">) {
  return netProfitFor(product.suggestedPrice, product.supplierPrice, product.shippingCost);
}

export function marginPct(product: Pick<SupplierProduct, "supplierPrice" | "suggestedPrice" | "shippingCost">) {
  if (product.suggestedPrice <= 0) return 0;
  return (netProfit(product) / product.suggestedPrice) * 100;
}

/** Sources whose prices are examples rather than live supplier quotes. */
export const SAMPLE_SOURCES = new Set(["seed", "starter"]);

export function isSampleProduct(product: Pick<SupplierProduct, "source">) {
  return SAMPLE_SOURCES.has(product.source);
}

/** Re-screen every product's title so the risk label is never just assumed. */
function withVero(product: SupplierProduct): SupplierProduct & { veroMatch: string | null; veroReason: string } {
  const screen = screenVero(product.title, product.category);
  const veroRisk = stricterRisk(product.veroRisk, screen.risk);
  // The catalog itself can flag a product type as brand-sensitive even when the
  // title names no brand (e.g. tumblers, where lookalike listings get reported).
  const veroReason =
    veroRisk === "medium" && !screen.match
      ? "No brand in the name, but brand-name lookalikes are often reported in this product type. Keep brand names out of your title and photos."
      : screen.reason;
  // Older seeded rows named retailers as the supplier; sample rows never should.
  const supplier = isSampleProduct(product) ? SAMPLE_SUPPLIER : product.supplier;
  return { ...product, supplier, veroRisk, veroMatch: screen.match, veroReason };
}

/** Starter products with EXAMPLE prices — for the marketing pages only, when no shared products are stored. */
function starterCatalog(limit: number): SupplierProduct[] {
  return STARTER_ROWS.slice(0, limit).map((row) => {
    const shipping = SAMPLE_SHIPPING;
    const suggested = priceForEbay(row.supplierPrice, shipping);
    return {
      externalId: row.externalId,
      source: "starter",
      title: row.title,
      category: row.category,
      supplier: SAMPLE_SUPPLIER,
      supplierUrl: null,
      imageUrl: starterImageUrl(row.title),
      images: [],
      variants: [],
      details: null,
      supplierPrice: row.supplierPrice,
      suggestedPrice: suggested,
      shippingCost: shipping,
      shippingQuoted: false,
      monthlySales: row.monthlySales,
      competition: competitionFor(row.monthlySales),
      veroRisk: row.veroRisk,
    };
  });
}

export type CatalogProduct = ReturnType<typeof withVero>;

/**
 * Rows a seller can see: only their own products, so example data is never
 * mixed in with real ones. With no seller (marketing pages), only the shared
 * sample products (user_id is null).
 */
export function visibleTo(userId: number | null) {
  return userId == null ? isNull(catalogProducts.userId) : eq(catalogProducts.userId, userId);
}

/** The catalog as `userId` sees it; null for the shared sample products only. */
export async function getCatalog(userId: number | null, limit = 36): Promise<CatalogProduct[]> {
  const products = await loadCatalog(userId, limit);
  return products.map(withVero);
}

type CatalogRow = typeof catalogProducts.$inferSelect;

function rowToProduct(row: CatalogRow): SupplierProduct {
  return {
    externalId: row.externalId,
    source: row.source,
    title: row.title,
    category: row.category,
    supplier: row.supplier,
    // CJ products imported before the link was saved get it from their id.
    supplierUrl: row.supplierUrl ?? (cjPidOf(row.externalId) ? cjProductUrl(cjPidOf(row.externalId) as string, row.title) : null),
    imageUrl: row.imageUrl,
    images: Array.isArray(row.images) ? row.images.filter((url): url is string => typeof url === "string" && url !== "") : [],
    variants: Array.isArray(row.variants) ? row.variants.filter((v) => v && typeof v.sku === "string" && v.sku) : [],
    details: row.details && typeof row.details === "object" ? row.details : null,
    supplierPrice: Number(row.supplierPrice),
    suggestedPrice: Number(row.suggestedPrice),
    shippingCost: Number(row.shippingCost),
    shippingQuoted: row.shippingQuotedAt != null,
    monthlySales: row.monthlySales,
    competition: row.competition as SupplierProduct["competition"],
    veroRisk: row.veroRisk as SupplierProduct["veroRisk"],
  };
}

/**
 * One catalog product by externalId (e.g. "cj-<pid>") as `userId` sees it, with
 * the VeRO screen applied; null if absent. The seller's own row wins over a shared one.
 */
export async function getCatalogProduct(userId: number, externalId: string): Promise<CatalogProduct | null> {
  const [row] = await db
    .select()
    .from(catalogProducts)
    .where(and(eq(catalogProducts.externalId, externalId), visibleTo(userId)))
    .orderBy(sql`${catalogProducts.userId} is null`)
    .limit(1);
  return row ? withVero(rowToProduct(row)) : null;
}

async function loadCatalog(userId: number | null, limit: number): Promise<SupplierProduct[]> {
  try {
    const rows = await db
      .select()
      .from(catalogProducts)
      .where(visibleTo(userId))
      .orderBy(desc(catalogProducts.monthlySales))
      .limit(limit);
    // A seller with no products sees an empty catalog, never the examples.
    if (rows.length || userId != null) return rows.map(rowToProduct);
  } catch (error) {
    if (userId != null) throw error;
    // Marketing pages only: database not reachable yet, so fall through to the starter catalog.
  }
  return starterCatalog(limit);
}

export type CatalogStats = {
  productCount: number;
  categoryCount: number;
  supplierCount: number;
  medianMarginPct: number;
  averageNetProfit: number;
  /** True when the figures come from example prices, not live supplier quotes. */
  sample: boolean;
};

/** Numbers shown on the marketing site are computed from this — never hardcoded. */
export async function getCatalogStats(userId: number | null = null): Promise<CatalogStats> {
  const products = await getCatalog(userId, 60);
  if (!products.length) {
    return { productCount: 0, categoryCount: 0, supplierCount: 0, medianMarginPct: 0, averageNetProfit: 0, sample: false };
  }
  const margins = products.map((p) => marginPct(p)).sort((a, b) => a - b);
  const mid = Math.floor(margins.length / 2);
  const median = margins.length % 2 === 0 ? (margins[mid - 1] + margins[mid]) / 2 : margins[mid];
  const profits = products.map((p) => netProfit(p));
  return {
    productCount: products.length,
    categoryCount: new Set(products.map((p) => p.category.toLowerCase())).size,
    supplierCount: new Set(products.map((p) => p.supplier)).size,
    medianMarginPct: Math.round(median * 10) / 10,
    averageNetProfit: Math.round((profits.reduce((a, b) => a + b, 0) / profits.length) * 100) / 100,
    sample: products.some(isSampleProduct),
  };
}
