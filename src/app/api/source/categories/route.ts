import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { getCjCategories } from "@/lib/cj/catalog";

/** GET /api/source/categories — CJ's top-level categories (cached for a day). Signed-in users only. */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  try {
    const result = await getCjCategories();
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, categories: result.data });
  } catch (error) {
    console.error("[source] categories failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Couldn't load categories." }, { status: 500 });
  }
}
