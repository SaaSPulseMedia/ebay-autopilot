import { listingCopyWithReason } from "@/lib/ai";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/ai-writer-test — Settings' "Test AI writer": writes the copy for
 * one sample product exactly as a listing would, and says whether Claude
 * wrote it or why the backup template was used. One small Claude call.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const started = Date.now();
  const { copy, failure } = await listingCopyWithReason({
    title: "2026 New Style Sweater For Women",
    category: "Women's Clothing / Tops & Sets / Sweaters",
    listPrice: 21.19,
    options: { colors: ["White", "Pink", "Khaki"], sizes: ["S", "M", "L", "XL"] },
  });
  return Response.json({ ok: failure == null, title: copy.title, failure, seconds: Math.round((Date.now() - started) / 100) / 10 });
}
