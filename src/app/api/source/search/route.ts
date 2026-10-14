import "server-only";

import { getCurrentUser } from "@/lib/auth";
import { searchCjProducts } from "@/lib/cj/catalog";

/** GET /api/source/search?q=<keyword>&page=<n> — CJ Dropshipping product search. Signed-in users only. */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  if (!q) return Response.json({ ok: false, error: "Enter a keyword to search." }, { status: 400 });
  if (q.length > 100) return Response.json({ ok: false, error: "Keep the search under 100 characters." }, { status: 400 });
  const page = Math.min(50, Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1));

  try {
    const result = await searchCjProducts(q, page);
    if (!result.ok) return Response.json({ ok: false, error: result.error }, { status: result.status });
    return Response.json({ ok: true, ...result.data });
  } catch (error) {
    console.error("[source] search failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Search failed. Try again in a moment." }, { status: 500 });
  }
}
