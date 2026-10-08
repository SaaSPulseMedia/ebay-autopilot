import "server-only";

import { publishListing } from "@/lib/ebay/inventory";
import { type CategoryAspect, resolveCategory } from "@/lib/ebay/taxonomy";

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
};

export type PublishWithResolverResult =
  | {
      ok: true;
      offerId: string;
      listingId: string;
      categoryId: string;
      categoryPath: string;
      usedFallbackCategory: boolean;
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
  });
  if (!result.ok) return { ok: false, step: result.step, error: result.error };

  return {
    ok: true,
    offerId: result.offerId,
    listingId: result.listingId,
    categoryId,
    categoryPath,
    usedFallbackCategory: !resolved.ok,
  };
}
