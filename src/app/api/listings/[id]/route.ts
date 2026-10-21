import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { listings } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getProductControl } from "@/lib/product-control";

export const dynamic = "force-dynamic";

/**
 * GET /api/listings/:id — the Product Control Center for one of the seller's
 * listings: images, CJ cost and link, the eBay link and live price, sizes and
 * CJ's description with its size chart (see getProductControl).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, error: "Invalid listing id." }, { status: 400 });
  const product = await getProductControl(user.id, { listingId: id });
  if (!product) return Response.json({ ok: false, error: "Listing not found." }, { status: 404 });
  return Response.json({ ok: true, product });
}

/** Statuses a seller may delete. Live listings must be ended first. */
const DELETABLE = ["ended", "draft"];

/** DELETE /api/listings/:id — permanently removes one of the signed-in seller's ended or draft listings. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ ok: false, error: "Invalid listing id." }, { status: 400 });

  // One conditional delete: ownership and status are checked in the same statement.
  const deleted = await db
    .delete(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, user.id), inArray(listings.status, DELETABLE)))
    .returning({ id: listings.id });
  if (deleted.length) return Response.json({ ok: true });

  const [existing] = await db
    .select({ status: listings.status })
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.userId, user.id)))
    .limit(1);
  if (!existing) return Response.json({ ok: false, error: "Listing not found." }, { status: 404 });
  return Response.json(
    { ok: false, error: `Only ended or draft listings can be deleted. End this ${existing.status} listing first.` },
    { status: 409 },
  );
}
