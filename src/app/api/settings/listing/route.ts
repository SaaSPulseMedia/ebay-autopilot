import { getCurrentUser } from "@/lib/auth";
import { saveListingDefaults } from "@/lib/seller-settings";

export const dynamic = "force-dynamic";

/** Save the seller's listing defaults (pricing rule, ad rate, quantity, handling, footer). */
export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  try {
    const defaults = await saveListingDefaults(user.id, body);
    return Response.json({ ok: true, defaults });
  } catch (error) {
    console.error("[settings/listing] save failed", error);
    return Response.json(
      { ok: false, error: "Your defaults could not be saved. Try again in a minute." },
      { status: 500 },
    );
  }
}
