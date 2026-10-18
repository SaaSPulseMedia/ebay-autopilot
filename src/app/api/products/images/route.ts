import "server-only";

import { getCurrentUser } from "@/lib/auth";
import {
  MAX_IMAGES,
  isWebUrl,
  ownedUploadIds,
  resetImageList,
  saveImageList,
  supplierImages,
  uploadIdFromUrl,
  userImageLists,
} from "@/lib/product-images";
import { getCatalog } from "@/lib/suppliers";

/**
 * The signed-in seller's images for one catalog product.
 *   GET    ?externalId=…            → { images, supplierImages, custom }
 *   PUT    { externalId, images }   → saves the order (main image first)
 *   DELETE ?externalId=…            → back to the supplier's images
 * Only the product's supplier images and the seller's own uploads can be saved.
 */
export const dynamic = "force-dynamic";

async function findProduct(externalId: string) {
  return (await getCatalog(500)).find((p) => p.externalId === externalId) ?? null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const externalId = new URL(request.url).searchParams.get("externalId") ?? "";
  const product = externalId ? await findProduct(externalId) : null;
  if (!product) return Response.json({ ok: false, error: "That product is not in the catalog." }, { status: 404 });

  const supplier = supplierImages(product);
  const saved = (await userImageLists(user.id, [externalId])).get(externalId);
  return Response.json({ ok: true, images: saved?.length ? saved : supplier, supplierImages: supplier, custom: Boolean(saved?.length) });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { externalId?: unknown; images?: unknown } | null;
  const externalId = typeof body?.externalId === "string" ? body.externalId : "";
  const product = externalId ? await findProduct(externalId) : null;
  if (!product) return Response.json({ ok: false, error: "That product is not in the catalog." }, { status: 404 });

  const images = [...new Set((Array.isArray(body?.images) ? body.images : []).filter(isWebUrl).map((u) => u.trim()))];
  if (!images.length) return Response.json({ ok: false, error: "Keep at least one image." }, { status: 400 });
  if (images.length > MAX_IMAGES) {
    return Response.json({ ok: false, error: `eBay allows up to ${MAX_IMAGES} images per listing.` }, { status: 400 });
  }

  const supplier = new Set(supplierImages(product));
  const uploadIds = images.map(uploadIdFromUrl).filter((id): id is string => Boolean(id));
  const owned = await ownedUploadIds(user.id, uploadIds);
  const unknown = images.filter((url) => !supplier.has(url) && !owned.has(uploadIdFromUrl(url) ?? ""));
  if (unknown.length) return Response.json({ ok: false, error: "Some of those images don't belong to this product." }, { status: 400 });

  await saveImageList(user.id, externalId, images);
  return Response.json({ ok: true, images, custom: true });
}

export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const externalId = new URL(request.url).searchParams.get("externalId") ?? "";
  const product = externalId ? await findProduct(externalId) : null;
  if (!product) return Response.json({ ok: false, error: "That product is not in the catalog." }, { status: 404 });
  await resetImageList(user.id, externalId);
  return Response.json({ ok: true, images: supplierImages(product), custom: false });
}
