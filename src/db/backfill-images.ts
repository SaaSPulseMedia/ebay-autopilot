import { and, eq, isNull, like, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { LEGACY_PLACEHOLDER_PREFIX, STARTER_ROWS, starterImageUrl } from "../lib/starter-catalog";
import { catalogProducts } from "./schema";

/**
 * Gives each starter catalog row its current placeholder image, in place. Only
 * rows with no image or an old picsum.photos placeholder are touched; any other
 * image URL (a real product photo) and every other column are left alone. Safe
 * to run more than once. Shared by `npm run db:seed`,
 * /api/admin/backfill-catalog-images and /api/admin/refresh-catalog-images.
 */
export async function backfillStarterImages(db: NodePgDatabase<Record<string, unknown>>) {
  const updated: string[] = [];
  for (const row of STARTER_ROWS) {
    const rows = await db
      .update(catalogProducts)
      .set({ imageUrl: starterImageUrl(row.title) })
      .where(
        and(
          eq(catalogProducts.externalId, row.externalId),
          or(
            isNull(catalogProducts.imageUrl),
            eq(catalogProducts.imageUrl, ""),
            like(catalogProducts.imageUrl, `${LEGACY_PLACEHOLDER_PREFIX}%`),
          ),
        ),
      )
      .returning({ externalId: catalogProducts.externalId });
    updated.push(...rows.map((r) => r.externalId));
  }
  return { checked: STARTER_ROWS.length, updated: updated.length, updatedIds: updated };
}
