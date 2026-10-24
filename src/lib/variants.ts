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

/** "70x140cm", "30*40 cm": a dimension, which is a size too. */
const DIMENSIONS = /^\d+(?:\.\d+)?\s*(?:cm|mm|in|inch|")?\s*[x×*]\s*\d+/i;

/** True when every value reads like a size (letters, numbers with units, dimensions, "EU 42"). */
export function looksLikeSizes(values: string[]) {
  return values.every((raw) => {
    const v = raw.trim();
    return SIZE_LIKE.test(v) || DIMENSIONS.test(v) || /^(?:EUR?|US|UK)\s*\d/i.test(v) || /^\d+(?:\.\d+)?\s*(?:EUR?|US|UK)$/i.test(v);
  });
}

/** Free-text eBay variation names a supplier option can go out under when its own name can't, best first. */
const FALLBACK_OPTION_NAMES = ["Style", "Type", "Model", "Pattern", "Design"];

/**
 * Renames supplier options eBay can't vary by in this category so the
 * variants can still go out as variations: an option the category doesn't
 * allow (e.g. "Size" on towels), or a "Size" whose values aren't sizes at all
 * ("Style18", "10pcs") where the category's Size only takes its own list, is
 * listed under the first allowed free-text name ("Style", "Type", …).
 * `sizeAspect` is the category's standardized size aspect: real sizes keep
 * their "Size" name so standardizeSizes can map them to it. Options with no
 * allowed name left are kept as they are (variationProblem then says why).
 */
export function relabelVariantOptions(
  variants: Variant[],
  allowedAspects: string[],
  selectionOnly: Record<string, string[]> = {},
  sizeAspect: string | null = null,
): Variant[] {
  const allowed = new Map(allowedAspects.map((name) => [name.toLowerCase(), name]));
  const listed = new Set(Object.keys(selectionOnly).map((name) => name.toLowerCase()));
  const names = Object.keys(variants[0]?.options ?? {});
  const used = new Set(names.map((name) => name.toLowerCase()));
  const rename = new Map<string, string>();
  for (const name of names) {
    const isSize = /^size$/i.test(name);
    const realSizes = isSize && looksLikeSizes(variants.map((v) => v.options[name] ?? ""));
    if (isSize && realSizes && sizeAspect) continue;
    const sizeOnlyTakesList = isSize && (listed.has(name.toLowerCase()) || Boolean(sizeAspect));
    if (allowed.has(name.toLowerCase()) && !(isSize && !realSizes && sizeOnlyTakesList)) continue;
    const target = FALLBACK_OPTION_NAMES.map((n) => n.toLowerCase()).find(
      (n) => allowed.has(n) && !listed.has(n) && !used.has(n),
    );
    if (!target) continue;
    rename.set(name, allowed.get(target) as string);
    used.add(target);
  }
  if (!rename.size) return variants;
  return variants.map((v) => ({
    ...v,
    options: Object.fromEntries(Object.entries(v.options).map(([key, value]) => [rename.get(key) ?? key, value])),
  }));
}

/** eBay's limits on a variation's aspect name and value. */
const MAX_VARIATION_NAME = 40;
const MAX_VARIATION_VALUE = 65;

/**
 * Why these variants can't be one eBay multi-variation listing, or null if
 * they can. Every variant needs the same aspect names (all within what the
 * category allows for variations), each with a value eBay accepts (within its
 * length limit, and from the category's list when the aspect has one; see
 * CategorySuggestion.variationValues), with no two variants alike.
 */
export function variationProblem(
  variants: Variant[],
  allowedAspects: string[],
  allowedValues: Record<string, string[]> = {},
): string | null {
  if (variants.length < 2) return "fewer than two variants";
  const names = Object.keys(variants[0].options).sort();
  if (!names.length) return "the supplier's variant names could not be read as Color or Size";
  const allowed = new Set(allowedAspects.map((name) => name.toLowerCase()));
  const blocked = names.filter((name) => !allowed.has(name.toLowerCase()));
  if (blocked.length) return `this eBay category does not allow variations by ${blocked.join(" and ")}`;
  const tooLong = names.find((name) => name.length > MAX_VARIATION_NAME);
  if (tooLong) return `the variation name "${tooLong}" is longer than eBay allows`;
  const lists = new Map(
    Object.entries(allowedValues).map(([name, values]) => [name.toLowerCase(), new Set(values.map((v) => v.toLowerCase()))]),
  );
  const combos = new Set<string>();
  for (const variant of variants) {
    if (Object.keys(variant.options).sort().join("|") !== names.join("|")) {
      return "the supplier's variants do not all have the same options";
    }
    for (const name of names) {
      const value = variant.options[name]?.trim() ?? "";
      if (!value) return `variant ${variant.sku} has no ${name}`;
      if (value.length > MAX_VARIATION_VALUE) return `the ${name} "${value}" is longer than eBay allows`;
      const list = lists.get(name.toLowerCase());
      if (list?.size && !list.has(value.toLowerCase())) return `"${value}" is not a ${name} eBay accepts in this category`;
    }
    const combo = names.map((name) => variant.options[name].toLowerCase()).join("|");
    if (combos.has(combo)) return `two variants are both "${names.map((name) => variant.options[name]).join(" / ")}"`;
    combos.add(combo);
  }
  return null;
}
