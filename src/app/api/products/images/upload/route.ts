import "server-only";

import { getCurrentUser } from "@/lib/auth";
import {
  MAX_IMAGES,
  MAX_UPLOADS_PER_USER,
  MAX_UPLOAD_BYTES,
  processUpload,
  publicBaseUrl,
  saveImageList,
  storeUpload,
  supplierImages,
  uploadCount,
  userImageLists,
} from "@/lib/product-images";
import { getCatalog } from "@/lib/suppliers";

/**
 * POST multipart { externalId, file } — uploads a custom image for a catalog
 * product. The image is resized (longest side 800–1600 px) and stored, and
 * its public URL is put first in the seller's image list for that product.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Sign in first." }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const externalId = form?.get("externalId");
  const file = form?.get("file");
  if (typeof externalId !== "string" || !(file instanceof File)) {
    return Response.json({ ok: false, error: "Choose an image to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return Response.json({ ok: false, error: "That image is over 4 MB. Choose a smaller one." }, { status: 413 });
  }
  const product = (await getCatalog(500)).find((p) => p.externalId === externalId);
  if (!product) return Response.json({ ok: false, error: "That product is not in the catalog." }, { status: 404 });
  if ((await uploadCount(user.id)) >= MAX_UPLOADS_PER_USER) {
    return Response.json({ ok: false, error: `You've reached the limit of ${MAX_UPLOADS_PER_USER} uploaded images.` }, { status: 400 });
  }

  const current = (await userImageLists(user.id, [externalId])).get(externalId);
  const list = current?.length ? current : supplierImages(product);
  if (list.length >= MAX_IMAGES) {
    return Response.json(
      { ok: false, error: `This product already has ${MAX_IMAGES} images, eBay's limit. Remove one first.` },
      { status: 400 },
    );
  }

  let processed;
  try {
    processed = await processUpload(Buffer.from(await file.arrayBuffer()));
  } catch {
    return Response.json({ ok: false, error: "That file is not an image we can read. Use JPG, PNG, WebP or GIF." }, { status: 400 });
  }

  const id = await storeUpload(user.id, processed);
  const url = `${publicBaseUrl(request)}/api/images/${id}.jpg`;
  const images = [url, ...list];
  await saveImageList(user.id, externalId, images);
  console.log(`[images] user ${user.id} uploaded ${id} (${processed.width}x${processed.height}) for ${externalId}`);
  return Response.json({ ok: true, url, images, width: processed.width, height: processed.height });
}
