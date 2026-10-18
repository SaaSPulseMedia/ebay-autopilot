import "server-only";

import { publishListing } from "@/lib/ebay/inventory";
import { genderFromCategoryPath, standardizeShoeSizes } from "@/lib/ebay/shoe-sizes";
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
      /** Supplier sizes left out because the eBay footwear category has no matching size value. */
      skippedSizes?: string[];
    }
  | { ok: false; step: "setup" | "item" | "offer" | "publish" | "category"; error: string };

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

  // Footwear categories accept only their standardized sizes (custom values are
  // rejected): map each supplier size to the category's size list, and leave
  // out variants whose size has no match.
  let variants = input.variations ?? [];
  let variationFallback: string | undefined;
  let skippedSizes: string[] = [];
  const shoeSize = resolved.ok ? resolved.suggestion.shoeSize : null;
  if (shoeSize && variants.length > 1) {
    const plan = standardizeShoeSizes(variants, shoeSize, genderFromCategoryPath(categoryPath));
    skippedSizes = plan.skipped;
    if (skippedSizes.length) {
      console.warn(
        `[ebay-sizes] sku ${input.sku}: no ${shoeSize.name} value in ${categoryId} matches supplier size(s) ${skippedSizes.join(", ")}; those variants are left out.`,
      );
    }
    if (plan.variants.length < 2) {
      variationFallback = plan.variants.length
        ? `only one of the supplier's sizes matches an eBay ${shoeSize.name}`
        : `none of the supplier's sizes (${skippedSizes.join(", ")}) match an eBay ${shoeSize.name}`;
      console.warn(`[ebay-sizes] sku ${input.sku}: publishing as a single listing because ${variationFallback}.`);
      // A single listing still needs a valid size: use the one size that matched, if there is exactly one.
      const only = plan.variants[0]?.options[shoeSize.name];
      if (only) aspects = { ...aspects, [shoeSize.name]: [only] };
      else if (shoeSize.required && aspects[shoeSize.name]?.[0]) {
        // eBay requires a size here and none of the supplier's maps, so the category default stands in.
        variationFallback += `; eBay requires a ${shoeSize.name}, so the listing shows ${aspects[shoeSize.name][0]}: correct it in Seller Hub`;
      }
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
    skippedSizes: skippedSizes.length ? skippedSizes : undefined,
  };
}
