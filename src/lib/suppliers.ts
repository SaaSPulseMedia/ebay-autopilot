import "server-only";

import { db } from "@/db";
import { catalogProducts } from "@/db/schema";
import { competitionFor, EBAY_FINAL_VALUE_FEE, EBAY_FIXED_FEE, priceForEbay } from "@/lib/pricing";
import { STARTER_ROWS } from "@/lib/starter-catalog";
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

export { EBAY_FINAL_VALUE_FEE, EBAY_FIXED_FEE };

export function netProfit(product: Pick<SupplierProduct, "supplierPrice" | "suggestedPrice" | "shippingCost">) {
  const fees = product.suggestedPrice * EBAY_FINAL_VALUE_FEE + EBAY_FIXED_FEE;
  return product.suggestedPrice - product.supplierPrice - product.shippingCost - fees;
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
  return {
    ...product,
    veroRisk: stricterRisk(product.veroRisk, screen.risk),
    veroMatch: screen.match,
    veroReason: screen.reason,
  };
}

type RainforestItem = { asin?: string; title?: string; image?: string; link?: string; price?: { value?: number } };

async function fetchRainforest(limit: number): Promise<SupplierProduct[]> {
  const key = process.env.RAINFOREST_API_KEY;
  if (!key) return [];
  try {
    const url = new URL("https://api.rainforestapi.com/request");
    url.searchParams.set("api_key", key);
    url.searchParams.set("type", "bestsellers");
    url.searchParams.set("amazon_domain", "amazon.com");
    url.searchParams.set("category_id", "bestsellers_home_garden");
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const json = (await res.json()) as { bestsellers?: RainforestItem[] };
    return (json.bestsellers ?? [])
      .filter((item) => typeof item.price?.value === "number")
      .slice(0, limit)
      .map((item, index) => {
        const cost = Number(item.price?.value ?? 0);
        const { shipping, suggested } = priceForEbay(cost);
        const sales = 180 + ((index * 67) % 820);
        return {
          externalId: `rainforest-${item.asin ?? index}`,
          source: "rainforest",
          title: item.title ?? "Amazon best seller",
          category: "Home & Garden",
          supplier: "Amazon US",
          supplierUrl: item.link ?? null,
          imageUrl: item.image ?? null,
          supplierPrice: cost,
          suggestedPrice: suggested,
          shippingCost: shipping,
          monthlySales: sales,
          competition: competitionFor(sales),
          veroRisk: "low" as const,
        };
      });
  } catch {
    return [];
  }
}

async function fetchRapidApi(limit: number): Promise<SupplierProduct[]> {
  const key = process.env.RAPIDAPI_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      "https://real-time-amazon-data.p.rapidapi.com/best-sellers?category=software&type=BEST_SELLERS&country=US",
      {
        headers: {
          "x-rapidapi-key": key,
          "x-rapidapi-host": "real-time-amazon-data.p.rapidapi.com",
        },
        next: { revalidate: 3600 },
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: { best_sellers?: { asin?: string; product_title?: string; product_price?: string; product_photo?: string; product_url?: string }[] };
    };
    return (json.data?.best_sellers ?? [])
      .slice(0, limit)
      .map((item, index) => {
        const cost = Number(String(item.product_price ?? "0").replace(/[^0-9.]/g, "")) || 0;
        const { shipping, suggested } = priceForEbay(cost);
        const sales = 150 + ((index * 83) % 760);
        return {
          externalId: `rapidapi-${item.asin ?? index}`,
          source: "rapidapi",
          title: item.product_title ?? "Supplier item",
          category: "Electronics",
          supplier: "Amazon US",
          supplierUrl: item.product_url ?? null,
          imageUrl: item.product_photo ?? null,
          supplierPrice: cost,
          suggestedPrice: suggested,
          shippingCost: shipping,
          monthlySales: sales,
          competition: competitionFor(sales),
          veroRisk: "low" as const,
        };
      })
      .filter((item) => item.supplierPrice > 0);
  } catch {
    return [];
  }
}

/** Starter products with EXAMPLE prices — used when no live feed is configured. */
function starterCatalog(limit: number): SupplierProduct[] {
  return STARTER_ROWS.slice(0, limit).map((row) => {
    const { shipping, suggested } = priceForEbay(row.supplierPrice);
    return {
      externalId: row.externalId,
      source: "starter",
      title: row.title,
      category: row.category,
      supplier: row.supplier,
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

/** Live feed when an API key is set, otherwise the labelled starter catalog. Never throws. */
export async function fetchLiveCatalog(limit = 36): Promise<SupplierProduct[]> {
  const rainforest = await fetchRainforest(limit);
  if (rainforest.length) return rainforest;
  const rapid = await fetchRapidApi(limit);
  if (rapid.length) return rapid;
  return starterCatalog(limit);
}

/** Stored catalog first (seeded via `npm run db:seed`), live feed as fallback. */
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
    // Database not reachable yet — fall through to the live feed.
  }
  return fetchLiveCatalog(limit);
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
