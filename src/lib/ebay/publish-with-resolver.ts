import "server-only";

import { publishListing } from "@/lib/ebay/inventory";
import { defaultSizeValue, genderFromCategoryPath, standardizeSizes } from "@/lib/ebay/sizes";
import { type CategoryAspect, resolveCategory } from "@/lib/ebay/taxonomy";
import { type Variant, variationProblem } from "@/lib/variants";

/**
 * Publishes a catalog product with its eBay category resolved from the title
 * and every required item specific filled in. If the category cannot be
 * resolved, lists under Everything Else rather than blocking the publish.
 */

export type CatalogProductForPublish = {
  userId: number;
  sku: string;
  title: string;
  description: string;
  imageUrls: string[];
  price: number;
  quantity: number;
  brand?: string;
  mpn?: string;
  /** Product-supplied item specifics; these always win over defaults. */
  userAspects?: Record<string, string[]>;
  condition?: string;
  /** Real supplier variants; two or more publish as one multi-variation listing when the category allows. */
  variations?: Variant[];
};

export type PublishWithResolverResult =
  | {
      ok: true;
      offerId: string;
      listingId: string;
      categoryId: string;
      categoryPath: string;
      usedFallbackCategory: boolean;
      /** Variants on the eBay listing (1 for a single listing). */
      variations: number;
      /** Why the product's variants went out as a single listing, if they did. */
      variationFallback?: string;
      /** Size standardization in a size-constrained category (apparel, footwear). */
      sizes?: SizeReport;
    }
  | { ok: false; step: "market" | "setup" | "item" | "offer" | "publish" | "category"; error: string };

export type SizeReport = {
  /** The category's size aspect, e.g. "Size" or "US Shoe Size". */
  aspect: string;
  /** eBay size values the listing went out with. */
  published: string[];
  /** Supplier sizes with no valid eBay value; their variants were left out. */
  dropped: string[];
  /** Set when no supplier size fit and eBay requires one: the stand-in value used. */
  defaulted?: string;
};

/** Everything Else > Other: no required item specifics. */
export const FALLBACK_CATEGORY_ID = "88433";
const FALLBACK_CATEGORY_PATH = "Everything Else";

/**
 * Default for a required aspect the product didn't supply. Brand is never taken
 * from eBay's sample values, so a real brand name is never put on an unbranded
 * product (which would also trip VeRO).
 */
function defaultAspectValue(aspect: CategoryAspect, brand?: string) {
  if (aspect.name.toLowerCase() === "brand") return brand?.trim() || "Unbranded";
  if (aspect.mode === "SELECTION_ONLY" && aspect.sampleValues[0]) return aspect.sampleValues[0];
  return "Other";
}

export function buildAspects(
  required: CategoryAspect[],
  userAspects: Record<string, string[]> = {},
  brand?: string,
) {
  const aspects: Record<string, string[]> = { ...userAspects };
  const supplied = new Set(Object.keys(aspects).map((name) => name.toLowerCase()));
  for (const aspect of required) {
    if (supplied.has(aspect.name.toLowerCase())) continue;
    aspects[aspect.name] = [defaultAspectValue(aspect, brand)];
  }
  return aspects;
}

export async function publishWithResolver(input: CatalogProductForPublish): Promise<PublishWithResolverResult> {
  const resolved = await resolveCategory(input.userId, input.title);

  let categoryId = FALLBACK_CATEGORY_ID;
  let categoryPath = FALLBACK_CATEGORY_PATH;
  let aspects = input.userAspects ?? {};
  if (resolved.ok) {
    categoryId = resolved.suggestion.categoryId;
    categoryPath = resolved.suggestion.categoryPath;
    aspects = buildAspects(resolved.suggestion.requiredAspects, input.userAspects, input.brand);
  } else {
    console.warn(
      `[ebay-publish] category resolution failed for user ${input.userId} ("${input.title}"): ${resolved.error}. Using ${FALLBACK_CATEGORY_ID}.`,
    );
  }

  // Size-constrained categories (apparel "Size", footwear "US Shoe Size", …)
  // accept only their standardized values: map each supplier size to the
  // category's list and leave out variants whose size has no match.
  let variants = input.variations ?? [];
  let variationFallback: string | undefined;
  const sizeAspect = resolved.ok ? resolved.suggestion.sizeAspect : null;
  // Enforced when eBay gives a list to check against; shoe sizes are also converted to US without one.
  const sizeRule = sizeAspect && (sizeAspect.values.length || sizeAspect.kind === "shoe") ? sizeAspect : null;
  let sizes: SizeReport | undefined;
  /** The one supplier size a single listing goes out at, when exactly one matched. */
  let matchedSize: string | undefined;
  if (sizeRule && variants.length > 1) {
    const plan = standardizeSizes(variants, sizeRule, genderFromCategoryPath(categoryPath));
    sizes = { aspect: sizeRule.name, published: plan.mapped, dropped: plan.skipped };
    if (plan.skipped.length) {
      console.warn(
        `[ebay-sizes] sku ${input.sku}: no ${sizeRule.name} value in ${categoryId} matches supplier size(s) ${plan.skipped.join(", ")}; those variants are left out.`,
      );
    }
    if (plan.variants.length < 2) {
      variationFallback = plan.variants.length
        ? `only one of the supplier's sizes matches an eBay ${sizeRule.name}`
        : `none of the supplier's sizes match an eBay ${sizeRule.name}`;
      console.warn(`[ebay-sizes] sku ${input.sku}: publishing as a single listing because ${variationFallback}.`);
      // A single listing at the one size that matched.
      matchedSize = plan.variants[0]?.options[sizeRule.name];
    }
    variants = plan.variants;
  }

  // Variants go out as eBay variations only when the category lets the listing
  // vary by every one of their aspects; otherwise the product is one listing.
  if (variants.length > 1 && !variationFallback) {
    const problem = resolved.ok
      ? variationProblem(variants, resolved.suggestion.variationAspects)
      : "the eBay category could not be resolved";
    if (problem) {
      variationFallback = problem;
      console.warn(
        `[ebay-variations] sku ${input.sku}: publishing ${variants.length} variants as a single listing in ${categoryId} because ${problem}.`,
      );
    }
  }
  const variations =
    variants.length > 1 && !variationFallback
      ? variants.map((v) => ({ sku: v.sku, aspects: v.options, price: v.price, quantity: v.quantity, imageUrl: v.imageUrl }))
      : undefined;

  // When the size doesn't vary (a single listing, or variations by Color only),
  // the listing's own size value must still be one eBay accepts — never a
  // generic default like "Other".
  if (sizeRule && !variations?.some((v) => sizeRule.name in v.aspects)) {
    if (matchedSize) {
      aspects = { ...aspects, [sizeRule.name]: [matchedSize] };
      sizes = { ...(sizes ?? { aspect: sizeRule.name, dropped: [] }), published: [matchedSize] };
    } else if (sizeRule.required) {
      // No supplier size to use (none given, or none matched): eBay still
      // requires one, so stand in its "One Size" or first value, and say so.
      const standIn = defaultSizeValue(sizeRule.values) ?? aspects[sizeRule.name]?.[0];
      if (standIn) {
        aspects = { ...aspects, [sizeRule.name]: [standIn] };
        sizes = { ...(sizes ?? { aspect: sizeRule.name, dropped: [] }), published: [standIn], defaulted: standIn };
        console.warn(
          `[ebay-sizes] sku ${input.sku}: ${categoryId} requires a ${sizeRule.name} and no supplier size fits; using "${standIn}".`,
        );
      }
    } else {
      // Not required: leave the size off rather than send a value the supplier never gave.
      aspects = Object.fromEntries(Object.entries(aspects).filter(([name]) => name !== sizeRule.name));
    }
  }

  const result = await publishListing({
    userId: input.userId,
    sku: input.sku,
    title: input.title,
    description: input.description,
    imageUrls: input.imageUrls,
    price: input.price,
    quantity: input.quantity,
    categoryId,
    brand: input.brand,
    mpn: input.mpn,
    aspects,
    condition: input.condition,
    variations,
  });
  if (!result.ok) return { ok: false, step: result.step, error: result.error };

  return {
    ok: true,
    offerId: result.offerId,
    listingId: result.listingId,
    categoryId,
    categoryPath,
    usedFallbackCategory: !resolved.ok,
    variations: result.variations ?? 1,
    variationFallback,
    sizes,
  };
}
