import { db } from "@/db";
import { listings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import type { ListingDraft } from "@/lib/ebay/types";
import { planLimits } from "@/lib/limits";
import {
  checkPlanCapacity,
  connectedAccessToken,
  parseEngine,
  publishWithFallback,
  storedStatus,
} from "@/lib/listing-pipeline";
import { withFooter } from "@/lib/listing-defaults";
import { getListingDefaults } from "@/lib/seller-settings";
import { checkSupplierUrl } from "@/lib/supplier-policy";
import { screenVero } from "@/lib/vero";
import { and, desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.userId, user.id))
    .orderBy(desc(listings.createdAt))
    .limit(100);

  return Response.json({ ok: true, listings: rows });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Partial<ListingDraft> & { engine?: unknown };
  const title = (body.title ?? "").trim();
  if (!title) return Response.json({ ok: false, error: "A listing title is required." }, { status: 400 });

  const defaults = await getListingDefaults(user.id);
  const draft: ListingDraft = {
    title: title.slice(0, 80),
    description: withFooter(body.description ?? "", defaults.descriptionFooter),
    listPrice: Number(body.listPrice ?? 0),
    supplierPrice: Number(body.supplierPrice ?? 0),
    sourceUrl: body.sourceUrl ?? null,
    imageUrl: body.imageUrl ?? null,
    quantity: Number(body.quantity ?? defaults.quantityPerVariant),
  };

  // Retail-arbitrage gate: eBay does not allow fulfilling from another retailer.
  if (draft.sourceUrl) {
    const supplier = checkSupplierUrl(draft.sourceUrl);
    if (!supplier.allowed) {
      return Response.json({ ok: false, code: "supplier_blocked", error: supplier.reason }, { status: 422 });
    }
  }

  // VeRO gate: never publish a listing whose title names a protected brand.
  const vero = screenVero(draft.title);
  if (vero.risk === "high") {
    return Response.json(
      {
        ok: false,
        code: "vero_blocked",
        error: `Blocked to protect your eBay account: ${vero.reason} Remove the brand name, or choose an unbranded product.`,
        match: vero.match,
      },
      { status: 422 },
    );
  }

  const limitResponse = await checkPlanCapacity(user.id, planLimits(user.plan), 1);
  if (limitResponse) return limitResponse;

  const final = await publishWithFallback(draft, parseEngine(body.engine), await connectedAccessToken(user.id));

  const [saved] = await db
    .insert(listings)
    .values({
      userId: user.id,
      title: draft.title,
      description: draft.description,
      sourceUrl: draft.sourceUrl,
      imageUrl: draft.imageUrl,
      supplierPrice: draft.supplierPrice.toFixed(2),
      listPrice: draft.listPrice.toFixed(2),
      engine: final.engine,
      status: storedStatus(final),
      ebayItemId: final.itemId,
      aiGenerated: Boolean(body.description),
      payload: { ...draft, handlingDays: defaults.handlingDays, adRatePct: defaults.adRatePct },
    })
    .returning();

  const response =
    vero.risk === "medium" ? { ...final, message: `${final.message} Note: ${vero.reason}` } : final;
  return Response.json({ ok: true, result: response, listing: saved });
}

/** End a listing (or cancel a scheduled one) so it stops counting against the plan. */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { id?: number; action?: string };
  if (!body.id) return Response.json({ ok: false, error: "Listing ID is required." }, { status: 400 });

  if (body.action === "end") {
    const [updated] = await db
      .update(listings)
      .set({ status: "ended" })
      .where(and(eq(listings.id, body.id), eq(listings.userId, user.id)))
      .returning();

    if (!updated) return Response.json({ ok: false, error: "Listing not found." }, { status: 404 });
    return Response.json({ ok: true, listing: updated });
  }

  return Response.json({ ok: false, error: "Unsupported action." }, { status: 400 });
}
