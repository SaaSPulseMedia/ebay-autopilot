import { and, eq, isNull, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { STARTER_ROWS, starterImageUrl } from "../lib/starter-catalog";
import { catalogProducts } from "./schema";

/**
 * Gives each starter catalog row its placeholder image, in place. Only rows
 * with no image are touched; existing images and every other column are left
 * alone. Safe to run more than once. Shared by `npm run db:seed` and
 * /api/admin/backfill-catalog-images (which runs it on Vercel).
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
          or(isNull(catalogProducts.imageUrl), eq(catalogProducts.imageUrl, "")),
        ),
      )
      .returning({ externalId: catalogProducts.externalId });
    updated.push(...rows.map((r) => r.externalId));
  }
  return { checked: STARTER_ROWS.length, updated: updated.length, updatedIds: updated };
}
