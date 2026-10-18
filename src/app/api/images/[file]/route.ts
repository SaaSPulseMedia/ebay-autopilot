import { eq } from "drizzle-orm";

import { db } from "@/db";
import { uploadedImages } from "@/db/schema";

/**
 * GET /api/images/<id>.jpg — serves a seller-uploaded image. Public on
 * purpose: eBay downloads listing pictures from this URL. Ids are random
 * 96-bit values, and an image never changes once stored, so it caches forever.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ file: string }> }) {
  const { file } = await context.params;
  const id = file.match(/^([a-f0-9]{24})\.jpg$/)?.[1];
  if (!id) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ data: uploadedImages.data, contentType: uploadedImages.contentType })
    .from(uploadedImages)
    .where(eq(uploadedImages.id, id))
    .limit(1);
  if (!row) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(Buffer.from(row.data, "base64")), {
    headers: {
      "Content-Type": row.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
