import "server-only";

import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { marketQuery } from "@/lib/ebay/market-price";
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

/** A category's item specifics as a CategorySuggestion (required/optional aspects, variation rules, size list). */
async function describe(
  token: string,
  treeBase: string,
  category: { categoryId: string; categoryName: string; categoryPath: string },
): Promise<{ ok: true; suggestion: CategorySuggestion } | { ok: false; error: string }> {
  const aspectsResponse = await ebayFetch<AspectsResponse>(
    `${treeBase}/get_item_aspects_for_category?category_id=${encodeURIComponent(category.categoryId)}`,
    token,
  );
  if (aspectsResponse.errors?.length) {
    return { ok: false, error: ebayErrorMessage(aspectsResponse, "eBay did not return this category's item specifics.") };
  }
  const aspects = (aspectsResponse.aspects ?? []).map(toAspect).filter((a) => a.name);
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
      ...category,
      requiredAspects: aspects.filter((a) => a.required),
      optionalAspects: aspects.filter((a) => !a.required),
      variationAspects,
      variationValues,
      sizeAspect: sizeAspectOf(aspectsResponse, category.categoryPath),
    },
  };
}

/** The eBay US category tree's base path (its id rarely changes; cached per server instance). */
let treeIdCache: string | null = null;
async function treeBaseFor(token: string): Promise<{ ok: true; base: string } | { ok: false; error: string }> {
  if (!treeIdCache) {
    const tree = await ebayFetch<TreeIdResponse>("/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US", token);
    if (tree.errors?.length || !tree.categoryTreeId) {
      return { ok: false, error: ebayErrorMessage(tree, "eBay did not return a category tree.") };
    }
    treeIdCache = tree.categoryTreeId;
  }
  return { ok: true, base: `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeIdCache)}` };
}

/**
 * What to ask eBay for a category, best first: the full title, then its first
 * meaningful words, the words it repeats (a supplier title repeats what the
 * product is: "Stirring Cup … Coffee Cup … Stirring Cup" → "stirring cup"),
 * and its last words (often the product's name: "… Magnetic Water Cup").
 */
export function categoryQueries(title: string) {
  const words = marketQuery(title, 50).split(" ").filter(Boolean);
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const repeated = [...new Set(words.filter((w) => (counts.get(w) ?? 0) > 1))].slice(0, 4).join(" ");
  const last = [...new Set(words.slice(-4))].join(" ");
  return [...new Set([title.trim(), marketQuery(title, 6), repeated, last, marketQuery(title, 3)])].filter(Boolean);
}

export async function resolveCategory(userId: number, productTitle: string): Promise<ResolveCategoryResult> {
  try {
    const token = await getAccessTokenForUser(userId);
    if (!token) return { ok: false, error: "No eBay store connected." };
    const tree = await treeBaseFor(token);
    if (!tree.ok) return tree;

    // Long supplier titles ("… High Value Electric Stirring Cup Lazy Milkshake …") can match no category:
    // then fewer, meaningful words are tried (the same cleaning as the market price search).
    const queries = categoryQueries(productTitle);
    let ranked: Suggestion[] = [];
    let lastError = "eBay could not suggest a category for this product.";
    for (const q of queries) {
      const suggestions = await ebayFetch<SuggestionsResponse>(`${tree.base}/get_category_suggestions?q=${encodeURIComponent(q)}`, token);
      ranked = (suggestions.categorySuggestions ?? []).filter((s) => s.category?.categoryId);
      if (ranked.length) {
        if (q !== queries[0]) console.log(`[ebay-category] no category for the full title; "${q}" found ${ranked[0].category?.categoryName ?? "one"}`);
        break;
      }
      if (suggestions.errors?.length) lastError = ebayErrorMessage(suggestions, lastError);
    }
    const [top, ...rest] = ranked;
    if (!top?.category?.categoryId) return { ok: false, error: lastError };
    const described = await describe(token, tree.base, {
      categoryId: top.category.categoryId,
      categoryName: top.category.categoryName ?? "",
      categoryPath: categoryPath(top),
    });
    if (!described.ok) return described;
    return {
      ok: true,
      suggestion: described.suggestion,
      alternatives: rest.slice(0, MAX_ALTERNATIVES).map((s) => ({
        categoryId: s.category?.categoryId ?? "",
        categoryPath: categoryPath(s),
      })),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Category lookup failed." };
  }
}

/** One of resolveCategory's alternatives, described like its top suggestion (one more Taxonomy call). */
export async function describeCategory(
  userId: number,
  category: { categoryId: string; categoryPath: string },
): Promise<{ ok: true; suggestion: CategorySuggestion } | { ok: false; error: string }> {
  try {
    const token = await getAccessTokenForUser(userId);
    if (!token) return { ok: false, error: "No eBay store connected." };
    const tree = await treeBaseFor(token);
    if (!tree.ok) return tree;
    const name = category.categoryPath.split(" > ").pop() ?? "";
    return await describe(token, tree.base, { ...category, categoryName: name });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Category lookup failed." };
  }
}
