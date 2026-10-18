import { createHash } from "node:crypto";

import type { CatalogVariant } from "@/db/schema";

/** One listing variant. `options` holds its variation aspects, e.g. { Color: "Black", Size: "36" }. */
export type Variant = {
  sku: string;
  options: Record<string, string>;
  price: number;
  quantity: number;
  imageUrl?: string | null;
};

function slug(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
}

/**
 * Deterministic eBay SKU for a whole product (one inventory item). The hash of
 * the full title keeps two products whose titles share a prefix apart.
 */
export function productSku(title: string) {
  const hash = createHash("sha256").update(title.trim().toLowerCase()).digest("hex").slice(0, 8).toUpperCase();
  return `${slug(title) || "ITEM"}-${hash}`;
}

/** eBay SKUs: at most 50 characters; keep to letters, digits and - _ . */
export function ebaySku(value: string) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
}

/** "36", "XL", "2XL", "10.5", "30cm", "One Size" — values that name a size rather than a color. */
const SIZE_LIKE =
  /^(?:\d+(?:\.\d+)?\s*(?:cm|mm|m|in|inch|inches|ft|ml|l|oz|g|kg|")?|(?:\d?x{0,3})?[sml]|\d?x{1,3}l|one size|free size)$/i;

/**
 * Variation aspects for one CJ variant. CJ's key gives color and size by
 * position; a lone value that reads like a size ("XL", "36") is a Size, and a
 * pair written size-first ("36-Black") is swapped.
 */
export function variantOptions(variant: Pick<CatalogVariant, "color" | "size">): Record<string, string> {
  let color = variant.color?.trim() || "";
  let size = variant.size?.trim() || "";
  if (color && !size && SIZE_LIKE.test(color)) [color, size] = ["", color];
  else if (color && size && SIZE_LIKE.test(color) && !SIZE_LIKE.test(size)) [color, size] = [size, color];
  const options: Record<string, string> = {};
  if (color) options.Color = color;
  if (size) options.Size = size;
  return options;
}

/**
 * The variants a listing is published with. Only real supplier variants are
 * used; a product without at least two of them is one listing with one
 * variant. Each variant is priced from the base list price in proportion to
 * its supplier cost (never below the base price).
 */
export function listingVariants(args: {
  sku: string;
  listPrice: number;
  supplierPrice: number;
  quantity: number;
  supplierVariants?: CatalogVariant[];
  maxVariants: number;
}): Variant[] {
  const single: Variant[] = [{ sku: args.sku, options: {}, price: args.listPrice, quantity: args.quantity }];
  const supplied = (args.supplierVariants ?? []).slice(0, Math.max(1, args.maxVariants));
  if (supplied.length < 2) return single;

  const seen = new Set<string>();
  const rows: Variant[] = [];
  for (const variant of supplied) {
    const sku = ebaySku(variant.sku);
    if (!sku || seen.has(sku)) continue;
    seen.add(sku);
    const ratio = args.supplierPrice > 0 && variant.price > 0 ? variant.price / args.supplierPrice : 1;
    rows.push({
      sku,
      options: variantOptions(variant),
      price: Math.round(Math.max(args.listPrice, args.listPrice * ratio) * 100) / 100,
      quantity: args.quantity,
      imageUrl: variant.image || null,
    });
  }
  return rows.length >= 2 ? rows : single;
}

/**
 * Why these variants can't be one eBay multi-variation listing, or null if
 * they can. Every variant needs the same aspect names (all within what the
 * category allows for variations), with no two variants alike.
 */
export function variationProblem(variants: Variant[], allowedAspects: string[]): string | null {
  if (variants.length < 2) return "fewer than two variants";
  const names = Object.keys(variants[0].options).sort();
  if (!names.length) return "the supplier's variant names could not be read as Color or Size";
  const allowed = new Set(allowedAspects.map((name) => name.toLowerCase()));
  const blocked = names.filter((name) => !allowed.has(name.toLowerCase()));
  if (blocked.length) return `this eBay category does not allow variations by ${blocked.join(" and ")}`;
  const combos = new Set<string>();
  for (const variant of variants) {
    if (Object.keys(variant.options).sort().join("|") !== names.join("|")) {
      return "the supplier's variants do not all have the same options";
    }
    const combo = names.map((name) => variant.options[name].toLowerCase()).join("|");
    if (combos.has(combo)) return `two variants are both "${names.map((name) => variant.options[name]).join(" / ")}"`;
    combos.add(combo);
  }
  return null;
}
