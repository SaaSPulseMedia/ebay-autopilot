import { and, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts, listings, productImages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/catalog/:externalId — removes a product from the catalog.
 * Refused while any active listing still comes from it. Listings link to their
 * catalog product through payload.externalId (newer listings) or, for older
 * ones, through the product's image URL. Never touches eBay.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ externalId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const externalId = decodeURIComponent((await params).externalId ?? "").trim();
  if (!externalId) return Response.json({ ok: false, error: "Missing product id." }, { status: 400 });

  const [product] = await db
    .select({ id: catalogProducts.id, imageUrl: catalogProducts.imageUrl, images: catalogProducts.images })
    .from(catalogProducts)
    .where(eq(catalogProducts.externalId, externalId))
    .limit(1);
  if (!product) return Response.json({ ok: false, error: "That product is not in the catalog." }, { status: 404 });

  const imageUrls = [...new Set([product.imageUrl, ...(product.images ?? [])].filter((u): u is string => Boolean(u)))];
  const [active] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.status, "active"),
        or(
          sql`${listings.payload}->>'externalId' = ${externalId}`,
          imageUrls.length ? inArray(listings.imageUrl, imageUrls) : undefined,
        ),
      ),
    )
    .limit(1);
  if (active) return Response.json({ ok: false, error: "End and delete the eBay listing first." }, { status: 409 });

  await db.transaction(async (tx) => {
    await tx.delete(productImages).where(eq(productImages.externalId, externalId));
    await tx.delete(catalogProducts).where(eq(catalogProducts.id, product.id));
  });
  return Response.json({ ok: true });
}
