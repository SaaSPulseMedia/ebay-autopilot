import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { catalogProducts, listings, productImages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/catalog/:externalId — removes a product from the signed-in
 * seller's own catalog. Shared sample products (no owner) can't be deleted,
 * and other sellers' copies are never touched. Refused while one of the
 * seller's active listings still comes from it: listings link to their catalog
 * product through payload.externalId (newer listings) or, for older ones,
 * through the product's image URL. Never touches eBay.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ externalId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const externalId = decodeURIComponent((await params).externalId ?? "").trim();
  if (!externalId) return Response.json({ ok: false, error: "Missing product id." }, { status: 400 });

  const rows = await db
    .select({
      id: catalogProducts.id,
      userId: catalogProducts.userId,
      imageUrl: catalogProducts.imageUrl,
      images: catalogProducts.images,
    })
    .from(catalogProducts)
    .where(
      and(
        eq(catalogProducts.externalId, externalId),
        or(eq(catalogProducts.userId, user.id), isNull(catalogProducts.userId)),
      ),
    );
  const product = rows.find((row) => row.userId === user.id);
  if (!product) {
    return rows.length
      ? Response.json({ ok: false, error: "Sample products are shared and can't be deleted." }, { status: 403 })
      : Response.json({ ok: false, error: "That product is not in your catalog." }, { status: 404 });
  }

  const imageUrls = [...new Set([product.imageUrl, ...(product.images ?? [])].filter((u): u is string => Boolean(u)))];
  const [active] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(
      and(
        eq(listings.userId, user.id),
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
    await tx.delete(productImages).where(and(eq(productImages.userId, user.id), eq(productImages.externalId, externalId)));
    // The owner check is repeated here so the delete itself can only hit this seller's row.
    await tx.delete(catalogProducts).where(and(eq(catalogProducts.id, product.id), eq(catalogProducts.userId, user.id)));
  });
  return Response.json({ ok: true });
}
