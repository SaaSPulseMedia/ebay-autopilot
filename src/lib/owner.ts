import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * The store owner: the seller whose CJ account AutoPilot's CJ_API_KEY is,
 * named by CJ_ACCOUNT_OWNER_EMAIL (default: the store's original seller).
 * Only they may pay from that CJ wallet, and their own account has no plan
 * listing limit.
 */
const ownerEmail = () => (process.env.CJ_ACCOUNT_OWNER_EMAIL ?? "itsy@store.com").trim().toLowerCase();

export async function isStoreOwner(userId: number) {
  const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row?.email) && row.email.trim().toLowerCase() === ownerEmail();
}
