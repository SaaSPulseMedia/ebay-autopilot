import "server-only";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { competitionFor, netProfitFor, priceForEbay } from "@/lib/pricing";
import { SAMPLE_SUPPLIER, STARTER_ROWS } from "@/lib/starter-catalog";
import { screenVero, stricterRisk } from "@/lib/vero";
import { desc } from "drizzle-orm";

export type SupplierProduct = {
  externalId: string;
  source: string;
  title: string;
  category: string;
  supplier: string;
  supplierUrl: string | null;
  imageUrl: string | null;
  supplierPrice: number;
  suggestedPrice: number;
  shippingCost: number;
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

/** Starter products with EXAMPLE prices — used when the catalog table is empty. */
function starterCatalog(limit: number): SupplierProduct[] {
  return STARTER_ROWS.slice(0, limit).map((row) => {
    const { shipping, suggested } = priceForEbay(row.supplierPrice);
    return {
      externalId: row.externalId,
      source: "starter",
      title: row.title,
      category: row.category,
      supplier: SAMPLE_SUPPLIER,
      supplierUrl: null,
      imageUrl: null,
      supplierPrice: row.supplierPrice,
      suggestedPrice: suggested,
      shippingCost: shipping,
      monthlySales: row.monthlySales,
      competition: competitionFor(row.monthlySales),
      veroRisk: row.veroRisk,
    };
  });
}

export type CatalogProduct = ReturnType<typeof withVero>;

export async function getCatalog(limit = 36): Promise<CatalogProduct[]> {
  const products = await loadCatalog(limit);
  return products.map(withVero);
}

async function loadCatalog(limit: number): Promise<SupplierProduct[]> {
  try {
    const rows = await db
      .select()
      .from(catalogProducts)
      .orderBy(desc(catalogProducts.monthlySales))
      .limit(limit);
    if (rows.length) {
      return rows.map((row) => ({
        externalId: row.externalId,
        source: row.source,
        title: row.title,
        category: row.category,
        supplier: row.supplier,
        supplierUrl: row.supplierUrl,
        imageUrl: row.imageUrl,
        supplierPrice: Number(row.supplierPrice),
        suggestedPrice: Number(row.suggestedPrice),
        shippingCost: Number(row.shippingCost),
        monthlySales: row.monthlySales,
        competition: row.competition as SupplierProduct["competition"],
        veroRisk: row.veroRisk as SupplierProduct["veroRisk"],
      }));
    }
  } catch {
    // Database not reachable yet — fall through to the starter catalog.
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
export async function getCatalogStats(): Promise<CatalogStats> {
  const products = await getCatalog(60);
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
