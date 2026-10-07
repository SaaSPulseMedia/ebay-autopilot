import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sellerSettings } from "@/db/schema";
import { DEFAULT_LISTING_DEFAULTS, normalizeDefaults, type ListingDefaults } from "@/lib/listing-defaults";

/**
 * Reads a seller's listing defaults. Falls back to the built-in defaults if the
 * seller has never saved any — or if the table does not exist yet on a database
 * that has not had the new SQL run, so listing keeps working either way.
 */
export async function getListingDefaults(userId: number): Promise<ListingDefaults> {
  try {
    const [row] = await db.select().from(sellerSettings).where(eq(sellerSettings.userId, userId)).limit(1);
    return row ? normalizeDefaults(row) : DEFAULT_LISTING_DEFAULTS;
  } catch (error) {
    console.warn("[seller-settings] using built-in defaults:", error instanceof Error ? error.message : error);
    return DEFAULT_LISTING_DEFAULTS;
  }
}

export async function saveListingDefaults(userId: number, input: unknown): Promise<ListingDefaults> {
  const values = normalizeDefaults((input ?? {}) as Record<string, unknown>);
  await db
    .insert(sellerSettings)
    .values({ userId, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({ target: sellerSettings.userId, set: { ...values, updatedAt: new Date() } });
  return values;
}
