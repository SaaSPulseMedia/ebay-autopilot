import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { subscriptions } from "@/db/schema";

export type SubscriptionRow = typeof subscriptions.$inferSelect;

/** Statuses that mean the customer has a subscription to manage. */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);

/**
 * The user's subscription row, or null. Never throws: before
 * /api/admin/migrate-billing has run the table doesn't exist yet, and the
 * Billing page must still render.
 */
export async function getSubscriptionForUser(userId: number): Promise<SubscriptionRow | null> {
  try {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).limit(1);
    return row ?? null;
  } catch (error) {
    console.warn("[stripe] could not read subscriptions (run /api/admin/migrate-billing?):", error);
    return null;
  }
}

export function isLiveSubscription(row: SubscriptionRow | null) {
  return Boolean(row && LIVE_STATUSES.has(row.status));
}
