import { hasAdminToken } from "@/lib/admin-token";
import { getCurrentUser } from "@/lib/auth";
import { ebayRequest, getAccessTokenForUser } from "@/lib/ebay/client";

/**
 * TEMPORARY admin route: eBay Taxonomy lookups for picking a category.
 *   ?keyword=phone+mount  → category suggestions, plus required aspects of the top few
 *   ?category_id=9355     → required aspects of one category
 * Needs the `x-admin-token: <CRON_SECRET>` header and a session cookie.
 */
export const dynamic = "force-dynamic";

const ASPECT_LOOKUPS = 3;

type TreeId = { categoryTreeId?: string };
type Suggestions = { categorySuggestions?: { category?: { categoryId?: string; categoryName?: string } }[] };
type Aspects = {
  aspects?: {
    localizedAspectName?: string;
    aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; aspectUsage?: string };
    aspectValues?: { localizedValue?: string }[];
  }[];
};

async function requiredAspects(token: string, treeId: string, categoryId: string) {
  const res = await ebayRequest<Aspects>(
    `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    token,
  );
  if (res.body.errors?.length) return { categoryId, status: res.status, errors: res.body.errors };
  return {
    categoryId,
    status: res.status,
    required: (res.body.aspects ?? [])
      .filter((a) => a.aspectConstraint?.aspectRequired)
      .map((a) => ({
        name: a.localizedAspectName,
        mode: a.aspectConstraint?.aspectMode,
        sampleValues: (a.aspectValues ?? []).slice(0, 15).map((v) => v.localizedValue),
      })),
  };
}

export async function GET(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const keyword = params.get("keyword")?.trim();
  const categoryId = params.get("category_id")?.trim();
  if (!keyword && !categoryId) {
    return Response.json({ ok: false, error: "Pass ?keyword=… or ?category_id=…" }, { status: 400 });
  }

  const token = await getAccessTokenForUser(user.id);
  if (!token) return Response.json({ ok: false, error: "No usable eBay access token." });

  const tree = await ebayRequest<TreeId>("/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=EBAY_US", token);
  const treeId = tree.body.categoryTreeId;
  if (!treeId) return Response.json({ ok: false, step: "tree", status: tree.status, body: tree.body });

  const result: Record<string, unknown> = { ok: true, treeId };

  if (keyword) {
    const suggestions = await ebayRequest<Suggestions>(
      `/commerce/taxonomy/v1/category_tree/${encodeURIComponent(treeId)}/get_category_suggestions?q=${encodeURIComponent(keyword)}`,
      token,
    );
    result.suggestions = { status: suggestions.status, body: suggestions.body };
    const ids = (suggestions.body.categorySuggestions ?? [])
      .map((s) => s.category?.categoryId)
      .filter((id): id is string => Boolean(id))
      .slice(0, ASPECT_LOOKUPS);
    result.suggestedRequiredAspects = await Promise.all(ids.map((id) => requiredAspects(token, treeId, id)));
  }

  if (categoryId) result.category = await requiredAspects(token, treeId, categoryId);

  console.log("[ebay-category] debug:", JSON.stringify(result).slice(0, 4000));
  return Response.json(result);
}
