import "server-only";

import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { isFootwearPath, type SizeAspectKind } from "@/lib/ebay/sizes";

/**
 * Picks the eBay category for a product title and reports which item
 * specifics (aspects) that category needs, via the Taxonomy API.
 */

export type CategoryAspect = {
  name: string;
  mode: "FREE_TEXT" | "SELECTION_ONLY";
  required: boolean;
  sampleValues: string[];
};

export type CategorySuggestion = {
  categoryId: string;
  categoryName: string;
  /** e.g. "Cell Phones & Accessories > Accessories > Mounts & Holders" */
  categoryPath: string;
  requiredAspects: CategoryAspect[];
  optionalAspects: CategoryAspect[];
  /** Aspect names this category allows a multi-variation listing to vary by (e.g. Color, Size). */
  variationAspects: string[];
  /**
   * For each of those aspects that only takes eBay's own values (SELECTION_ONLY),
   * every value it accepts. Free-text aspects (usually Color) aren't listed.
   */
  variationValues: Record<string, string[]>;
  /**
   * The category's standardized size aspect ("US Shoe Size", "Size", …) with
   * every value eBay accepts, or null when it has none. eBay rejects custom
   * size values in these categories.
   */
  sizeAspect: SizeAspect | null;
};

export type SizeAspect = {
  name: string;
  /** "shoe": EU/UK sizes convert to US; "apparel": sizes match by name (S, M, XL…). */
  kind: SizeAspectKind;
  required: boolean;
  enabledForVariations: boolean;
  /** All allowed values; empty when the aspect is free text with no list. */
  values: string[];
};

export type ResolveCategoryResult =
  | { ok: true; suggestion: CategorySuggestion; alternatives: Array<{ categoryId: string; categoryPath: string }> }
  | { ok: false; error: string };

const MAX_SAMPLE_VALUES = 15;
const MAX_ALTERNATIVES = 5;

type TreeIdResponse = { categoryTreeId?: string };
type SuggestionsResponse = {
  categorySuggestions?: {
    category?: { categoryId?: string; categoryName?: string };
    categoryTreeNodeAncestors?: { categoryName?: string; categoryTreeNodeLevel?: number }[];
  }[];
};
type AspectsResponse = {
  aspects?: {
    localizedAspectName?: string;
    aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; aspectEnabledForVariations?: boolean };
    aspectValues?: { localizedValue?: string }[];
  }[];
};
type Suggestion = NonNullable<SuggestionsResponse["categorySuggestions"]>[number];

/** Root-first path; eBay lists ancestors nearest-first, so order them by tree level. */
function categoryPath(suggestion: Suggestion) {
  const ancestors = [...(suggestion.categoryTreeNodeAncestors ?? [])]
    .sort((a, b) => (a.categoryTreeNodeLevel ?? 0) - (b.categoryTreeNodeLevel ?? 0))
    .map((a) => a.categoryName)
    .filter((name): name is string => Boolean(name));
  return [...ancestors, suggestion.category?.categoryName ?? ""].filter(Boolean).join(" > ");
}

function toAspect(aspect: NonNullable<AspectsResponse["aspects"]>[number]): CategoryAspect {
  return {
    name: aspect.localizedAspectName ?? "",
    mode: aspect.aspectConstraint?.aspectMode === "SELECTION_ONLY" ? "SELECTION_ONLY" : "FREE_TEXT",
    required: Boolean(aspect.aspectConstraint?.aspectRequired),
    sampleValues: (aspect.aspectValues ?? [])
      .map((v) => v.localizedValue)
      .filter((v): v is string => Boolean(v))
      .slice(0, MAX_SAMPLE_VALUES),
  };
}

/**
 * The category's size aspect: "US Shoe Size" first, else any "… Shoe Size"
 * (both shoe kind), else a plain "Size" (shoe kind when the category path is
 * about footwear, apparel otherwise).
 */
function sizeAspectOf(response: AspectsResponse, path: string): SizeAspect | null {
  const aspects = response.aspects ?? [];
  const named = (test: (name: string) => boolean) => aspects.find((a) => test((a.localizedAspectName ?? "").trim()));
  const shoe = named((n) => /^us shoe size/i.test(n)) ?? named((n) => /shoe size/i.test(n));
  const plain = shoe ? undefined : named((n) => n === "Size");
  const aspect = shoe ?? plain;
  if (!aspect?.localizedAspectName) return null;
  return {
    name: aspect.localizedAspectName,
    kind: shoe || isFootwearPath(path) ? "shoe" : "apparel",
    required: Boolean(aspect.aspectConstraint?.aspectRequired),
    enabledForVariations: Boolean(aspect.aspectConstraint?.aspectEnabledForVariations),
    values: (aspect.aspectValues ?? []).map((v) => v.localizedValue?.trim() ?? "").filter(Boolean),
  };
}

export async function resolveCategory(userId: number, productTitle: string): Promise<ResolveCategoryResult> {
  try {
    const token = await getAccessTokenForUser(userId);
    if (!token) return { ok: false, error: "No eBay store connected." };

    const tree = await ebayFetch<TreeIdResponse>(
      "/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US",
      token,
    );
    if (tree.errors?.length || !tree.categoryTreeId) {
      return { ok: false, error: ebayErrorMessage(tree, "eBay did not return a category tree.") };
    }
    const treeBase = `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(tree.categoryTreeId)}`;

    const suggestions = await ebayFetch<SuggestionsResponse>(
      `${treeBase}/get_category_suggestions?q=${encodeURIComponent(productTitle)}`,
      token,
    );
    if (suggestions.errors?.length) {
      return { ok: false, error: ebayErrorMessage(suggestions, "eBay could not suggest a category for this product.") };
    }
    const ranked = (suggestions.categorySuggestions ?? []).filter((s) => s.category?.categoryId);
    const [top, ...rest] = ranked;
    if (!top?.category?.categoryId) {
      return { ok: false, error: "eBay could not suggest a category for this product." };
    }
    const categoryId = top.category.categoryId;

    const aspectsResponse = await ebayFetch<AspectsResponse>(
      `${treeBase}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
      token,
    );
    if (aspectsResponse.errors?.length) {
      return { ok: false, error: ebayErrorMessage(aspectsResponse, "eBay did not return this category's item specifics.") };
    }
    const aspects = (aspectsResponse.aspects ?? []).map(toAspect).filter((a) => a.name);
    const sizeAspect = sizeAspectOf(aspectsResponse, categoryPath(top));
    const variationAspects = (aspectsResponse.aspects ?? [])
      .filter((a) => a.aspectConstraint?.aspectEnabledForVariations && a.localizedAspectName)
      .map((a) => a.localizedAspectName as string);
    const variationValues = Object.fromEntries(
      (aspectsResponse.aspects ?? [])
        .filter(
          (a) =>
            a.aspectConstraint?.aspectEnabledForVariations &&
            a.aspectConstraint.aspectMode === "SELECTION_ONLY" &&
            a.localizedAspectName &&
            a.aspectValues?.length,
        )
        .map((a) => [
          a.localizedAspectName as string,
          (a.aspectValues ?? []).map((v) => v.localizedValue?.trim() ?? "").filter(Boolean),
        ]),
    );

    return {
      ok: true,
      suggestion: {
        categoryId,
        categoryName: top.category.categoryName ?? "",
        categoryPath: categoryPath(top),
        requiredAspects: aspects.filter((a) => a.required),
        optionalAspects: aspects.filter((a) => !a.required),
        variationAspects,
        variationValues,
        sizeAspect,
      },
      alternatives: rest.slice(0, MAX_ALTERNATIVES).map((s) => ({
        categoryId: s.category?.categoryId ?? "",
        categoryPath: categoryPath(s),
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Category lookup failed." };
  }
}
