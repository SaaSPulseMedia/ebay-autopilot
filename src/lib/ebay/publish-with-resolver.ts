import "server-only";

import { type PublishVariation, VARIANTS_INVALID, publishListing } from "@/lib/ebay/inventory";
import type { PromotionResult } from "@/lib/ebay/promoted";
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
  /** Use the seller's free-shipping policy (market-match pricing). */
  freeShipping?: boolean;
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
      /** Size standardization in a size-constrained category (apparel, footwear). */
      sizes?: SizeReport;
      /** Promoted Listings (General) outcome. */
      promotion?: PromotionResult;
    }
  | { ok: false; step: "market" | "setup" | "variants" | "item" | "offer" | "publish" | "category"; error: string };

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

/** Everything eBay will be sent for a product, worked out before anything is sent (see planEbayListing). */
export type EbayListingPlan = {
  ok: true;
  categoryId: string;
  categoryPath: string;
  usedFallbackCategory: boolean;
  aspects: Record<string, string[]>;
  variations: PublishVariation[] | undefined;
  sizes?: SizeReport;
};

/**
 * The eBay side of a listing, without publishing: its category (resolved from
 * the title), item specifics, and its variations with sizes standardized to
 * the category's values. Fails when the product's variants can't go out as
 * eBay variations (see VARIANTS_INVALID). publishWithResolver publishes this
 * plan; the sourcing checker runs it alone as a dry run.
 */
export async function planEbayListing(
  input: Pick<CatalogProductForPublish, "userId" | "sku" | "title" | "brand" | "userAspects" | "variations">,
): Promise<EbayListingPlan | { ok: false; step: "variants"; error: string }> {
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
  // category's list. If any size has no match, nothing is listed (never a
  // partial listing missing some of the supplier's sizes).
  let variants = input.variations ?? [];
  /** Two or more supplier variants: the product goes out as a multi-variation listing or not at all. */
  const hasVariants = variants.length > 1;
  let variantProblem: string | undefined;
  const sizeAspect = resolved.ok ? resolved.suggestion.sizeAspect : null;
  // Enforced when eBay gives a list to check against; shoe sizes are also converted to US without one.
  const sizeRule = sizeAspect && (sizeAspect.values.length || sizeAspect.kind === "shoe") ? sizeAspect : null;
  let sizes: SizeReport | undefined;
  if (sizeRule && hasVariants) {
    const plan = standardizeSizes(variants, sizeRule, genderFromCategoryPath(categoryPath));
    sizes = { aspect: sizeRule.name, published: plan.mapped, dropped: plan.skipped };
    if (plan.skipped.length) {
      variantProblem = `no eBay ${sizeRule.name} matches the supplier's size${plan.skipped.length === 1 ? "" : "s"} ${plan.skipped.join(", ")}`;
    } else if (plan.variants.length < 2) {
      variantProblem = plan.variants.length
        ? `only one of the supplier's sizes matches an eBay ${sizeRule.name}`
        : `none of the supplier's sizes match an eBay ${sizeRule.name}`;
    }
    variants = plan.variants;
  }

  // Variants go out as eBay variations only when the category lets the listing
  // vary by every one of their aspects, with values eBay accepts. Otherwise
  // nothing is sent: a single listing would drop the buyer's Color/Size choice.
  if (hasVariants && !variantProblem) {
    variantProblem =
      (resolved.ok
        ? variationProblem(variants, resolved.suggestion.variationAspects, resolved.suggestion.variationValues)
        : "the eBay category could not be resolved") ?? undefined;
  }
  if (variantProblem) {
    console.warn(`[ebay-variations] sku ${input.sku}: not listed in ${categoryId} because ${variantProblem}.`);
    return { ok: false, step: "variants", error: `${VARIANTS_INVALID} Reason: ${variantProblem}.` };
  }
  const variations = hasVariants
    ? variants.map((v) => ({ sku: v.sku, aspects: v.options, price: v.price, quantity: v.quantity, imageUrl: v.imageUrl }))
    : undefined;

  // When the size doesn't vary (a single listing, or variations by Color only),
  // the listing's own size value must still be one eBay accepts — never a
  // generic default like "Other".
  if (sizeRule && !variations?.some((v) => sizeRule.name in v.aspects)) {
    if (sizeRule.required) {
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

  return { ok: true, categoryId, categoryPath, usedFallbackCategory: !resolved.ok, aspects, variations, sizes };
}

export async function publishWithResolver(input: CatalogProductForPublish): Promise<PublishWithResolverResult> {
  const plan = await planEbayListing(input);
  if (!plan.ok) return plan;
  const { categoryId, categoryPath, aspects, variations, sizes } = plan;

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
    freeShipping: input.freeShipping,
  });
  if (!result.ok) return { ok: false, step: result.step, error: result.error };

  return {
    ok: true,
    offerId: result.offerId,
    listingId: result.listingId,
    categoryId,
    categoryPath,
    usedFallbackCategory: plan.usedFallbackCategory,
    variations: result.variations ?? 1,
    sizes,
    promotion: result.promotion,
  };
}
