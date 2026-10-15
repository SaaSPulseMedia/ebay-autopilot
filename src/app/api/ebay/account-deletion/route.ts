import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { ebayAccounts, listings, sessions, subscriptions, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";

/**
 * eBay Marketplace Account Deletion endpoint, required for the Production keyset.
 * Public on purpose: eBay calls it directly, with no AutoPilot session.
 *
 *   GET  ?challenge_code=…  → { challengeResponse: sha256(challengeCode + verificationToken + endpoint) }
 *   POST { notification: { data: { userId, username } } } → removes that seller's eBay data
 *
 * EBAY_VERIFICATION_TOKEN must equal the token entered in eBay's developer portal.
 * The endpoint URL in the hash must match the portal entry character for character.
 */
export const dynamic = "force-dynamic";

const DEFAULT_ENDPOINT = "https://ebay-autopilot.vercel.app/api/ebay/account-deletion";

function endpointUrl() {
  return process.env.EBAY_DELETION_ENDPOINT?.trim() || DEFAULT_ENDPOINT;
}

export async function GET(request: Request) {
  try {
    const challengeCode = new URL(request.url).searchParams.get("challenge_code");
    if (!challengeCode) return Response.json({ error: "Missing challenge_code" }, { status: 400 });

    const token = process.env.EBAY_VERIFICATION_TOKEN?.trim();
    if (!token) {
      console.error("[ebay-deletion] EBAY_VERIFICATION_TOKEN is not set; cannot answer eBay's challenge");
      return Response.json({ error: "Endpoint not configured" }, { status: 500 });
    }

    const challengeResponse = createHash("sha256")
      .update(challengeCode)
      .update(token)
      .update(endpointUrl())
      .digest("hex");
    return Response.json({ challengeResponse }, { status: 200 });
  } catch (error) {
    console.error("[ebay-deletion] challenge failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Challenge failed" }, { status: 500 });
  }
}

type DeletionNotification = {
  metadata?: { topic?: string };
  notification?: {
    notificationId?: string;
    data?: { userId?: unknown; username?: unknown; eiasToken?: unknown };
  };
};

export async function POST(request: Request) {
  let body: DeletionNotification | null;
  try {
    body = (await request.json()) as DeletionNotification;
  } catch {
    console.warn("[ebay-deletion] ignored a request whose body was not JSON");
    return Response.json({ ok: false, error: "Body must be JSON" }, { status: 400 });
  }

  const data = body?.notification?.data;
  const notificationId = body?.notification?.notificationId ?? "unknown";
  const ebayIds = [data?.userId, data?.username]
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
  if (!ebayIds.length) {
    console.warn(`[ebay-deletion] notification ${notificationId} has no userId; nothing to delete`);
    return Response.json({ ok: true }, { status: 200 });
  }

  try {
    const matches = await db
      .select({ userId: ebayAccounts.userId })
      .from(ebayAccounts)
      .where(inArray(ebayAccounts.ebayUserId, ebayIds));
    const userIds = [...new Set(matches.map((m) => m.userId))];

    if (!userIds.length) {
      console.log(`[ebay-deletion] notification ${notificationId}: no AutoPilot seller linked to this eBay user; nothing to delete`);
      return Response.json({ ok: true }, { status: 200 });
    }

    // A real bcrypt hash of a random value: the anonymized account can never be logged into.
    const unusablePassword = await hashPassword(randomUUID());
    await db.transaction(async (tx) => {
      await tx.delete(ebayAccounts).where(inArray(ebayAccounts.userId, userIds));
      await tx.delete(listings).where(inArray(listings.userId, userIds));
      await tx.delete(subscriptions).where(inArray(subscriptions.userId, userIds));
      await tx.delete(sessions).where(inArray(sessions.userId, userIds));
      for (const id of userIds) {
        await tx
          .update(users)
          .set({ email: `deleted-user-${id}@deleted.invalid`, passwordHash: unusablePassword, storeName: null })
          .where(eq(users.id, id));
      }
    });

    console.log(
      `[ebay-deletion] notification ${notificationId}: deleted eBay accounts, listings, subscriptions and sessions and anonymized ${userIds.length} AutoPilot user(s): ${userIds.join(", ")}`,
    );
    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    // Not 200: eBay retries failed deliveries, so the deletion gets another chance.
    console.error(
      `[ebay-deletion] notification ${notificationId} failed:`,
      error instanceof Error ? error.message : error,
    );
    return Response.json({ ok: false, error: "Deletion failed; please retry" }, { status: 500 });
  }
}
