import "server-only";

/**
 * Maps a CJ Dropshipping product (from GET /product/query) to an AutoPilot
 * catalog draft. Pure: no I/O. CJ sends many numbers as strings, sometimes as
 * ranges ("15.97 -- 21.70", "610.00-750.00"), so every field is parsed defensively.
 */

export type CjVariantFromApi = {
  vid?: string;
  pid?: string;
  variantSku?: string;
  variantNameEn?: string | null;
  variantKey?: string | null;
  variantImage?: string | null;
  variantSellPrice?: number | string | null;
  variantWeight?: number | string | null;
  barcode?: string | null;
  [key: string]: unknown;
};

export type CjProductFromApi = {
  pid?: string;
  productNameEn?: string;
  description?: string | null;
  productImage?: string | string[] | null;
  productImageSet?: string[] | string | null;
  sellPrice?: number | string | null;
  suggestSellPrice?: number | string | null;
  categoryName?: string | null;
  productSku?: string | null;
  productWeight?: number | string | null;
  listedNum?: number | string | null;
  variants?: CjVariantFromApi[] | null;
  [key: string]: unknown;
};

export type CatalogProductDraft = {
  externalId: string;
  title: string;
  description: string;
  images: string[];
  supplierPrice: number;
  suggestedRetailPrice: number;
  category: string;
  supplierName: "CJ Dropshipping";
  supplierSku: string;
  weightGrams: number;
  listedNum: number;
  variants: Array<{
    sku: string;
    name: string;
    key: string;
    color: string | null;
    size: string | null;
    image: string;
    price: number;
    weightGrams: number;
    /** UPC/EAN; empty when CJ has none (eBay then needs "Does not apply" where allowed). */
    barcode: string;
  }>;
};

/** All numbers in a value: 12, "12.5", "15.97 -- 21.70", "610.00-750.00". */
function numbersIn(value: unknown): number[] {
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value !== "string") return [];
  return (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
}

const minOf = (value: unknown) => {
  const n = numbersIn(value);
  return n.length ? Math.min(...n) : 0;
};
const maxOf = (value: unknown) => {
  const n = numbersIn(value);
  return n.length ? Math.max(...n) : 0;
};

/** Image lists arrive as arrays, JSON-encoded arrays, or a single URL string. */
function imageList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  if (typeof value !== "string" || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      return imageList(JSON.parse(trimmed));
    } catch {
      return [];
    }
  }
  return [trimmed];
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** "Black-36" → color/size; "Black" → color; "Classic-Black-36" → style, color, size. Else null. */
export function parseVariantKey(key: string | null | undefined): { color: string | null; size: string | null } | null {
  const parts = (key ?? "")
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 1) return { color: parts[0], size: null };
  if (parts.length === 2) return { color: parts[0], size: parts[1] };
  if (parts.length === 3) return { color: parts[1], size: parts[2] };
  return null;
}

export function mapCjProductToDraft(product: CjProductFromApi): CatalogProductDraft {
  const images = [...new Set([...imageList(product.productImageSet), ...imageList(product.productImage)])];

  const variants: CatalogProductDraft["variants"] = [];
  for (const v of product.variants ?? []) {
    const parsed = parseVariantKey(v.variantKey);
    const sku = text(v.variantSku);
    if (!parsed || !sku) continue;
    variants.push({
      sku,
      name: text(v.variantNameEn),
      key: text(v.variantKey),
      color: parsed.color,
      size: parsed.size,
      image: text(v.variantImage) || images[0] || "",
      price: minOf(v.variantSellPrice),
      weightGrams: maxOf(v.variantWeight),
      barcode: text(v.barcode),
    });
  }

  return {
    externalId: text(product.pid),
    title: text(product.productNameEn),
    description: text(product.description),
    images,
    // Ranges: cheapest variant (most conservative cost/retail), heaviest weight (safest shipping).
    supplierPrice: minOf(product.sellPrice),
    suggestedRetailPrice: minOf(product.suggestSellPrice),
    category: text(product.categoryName),
    supplierName: "CJ Dropshipping",
    supplierSku: text(product.productSku),
    weightGrams: maxOf(product.productWeight),
    listedNum: Math.round(maxOf(product.listedNum)),
    variants,
  };
}
