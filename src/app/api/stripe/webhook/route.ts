import { eq } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db";
import { stripeEvents, subscriptions, users } from "@/db/schema";
import { getStripe } from "@/lib/stripe/client";
import { isPlanId, planForPriceId } from "@/lib/stripe/plans";

/**
 * Stripe webhook. The only place a user's paid plan changes.
 *   checkout.session.completed     → save the subscription, set users.plan
 *   customer.subscription.updated  → active/trialing: plan from price; canceled/unpaid: trial
 *   customer.subscription.deleted  → trial
 *   invoice.payment_failed         → logged only
 * Each event id is recorded in stripe_events, so a redelivered event is skipped.
 */
export const dynamic = "force-dynamic";

const DOWNGRADE_PLAN = "trial";

function idOf(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : (value?.id ?? null);
}

/** Price and period end live on the subscription's first item (current Stripe API versions). */
function subscriptionDetails(sub: Stripe.Subscription) {
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end;
  return {
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: typeof periodEnd === "number" ? new Date(periodEnd * 1000) : null,
  };
}

async function userExists(userId: number) {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return Boolean(row);
}

async function setUserPlan(userId: number, plan: string, reason: string) {
  await db.update(users).set({ plan }).where(eq(users.id, userId));
  console.log(`[stripe] user ${userId} plan → ${plan} (${reason})`);
}

/** Our row for a subscription, falling back to the userId Checkout copied onto its metadata. */
async function findUserForSubscription(sub: Stripe.Subscription): Promise<number | null> {
  const [row] = await db
    .select({ userId: subscriptions.userId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);
  if (row) return row.userId;
  const fromMetadata = Number(sub.metadata?.userId);
  return Number.isInteger(fromMetadata) && fromMetadata > 0 && (await userExists(fromMetadata)) ? fromMetadata : null;
}

async function saveSubscription(userId: number, sub: Stripe.Subscription, plan: string) {
  const { currentPeriodEnd } = subscriptionDetails(sub);
  const values = {
    stripeCustomerId: idOf(sub.customer) ?? "",
    stripeSubscriptionId: sub.id,
    plan,
    status: sub.status,
    currentPeriodEnd,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== "subscription") return;
  const userId = Number(session.client_reference_id);
  const subscriptionId = idOf(session.subscription);
  if (!Number.isInteger(userId) || userId <= 0 || !subscriptionId || !(await userExists(userId))) {
    console.error(`[stripe] checkout.session.completed ${session.id}: unknown user or no subscription`, {
      clientReferenceId: session.client_reference_id,
      subscriptionId,
    });
    return;
  }

  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const { priceId } = subscriptionDetails(sub);
  // What they pay for wins; the plan in metadata is the fallback.
  const plan = planForPriceId(priceId) ?? (isPlanId(session.metadata?.planId) ? session.metadata.planId : null);
  if (!plan) {
    console.error(`[stripe] checkout ${session.id}: price ${priceId} matches no plan; user ${userId} left unchanged`);
    return;
  }

  await saveSubscription(userId, sub, plan);
  if (sub.status === "active" || sub.status === "trialing") await setUserPlan(userId, plan, `checkout ${session.id}`);
}

async function onSubscriptionUpdated(sub: Stripe.Subscription) {
  const userId = await findUserForSubscription(sub);
  if (!userId) {
    console.warn(`[stripe] subscription ${sub.id} updated but no matching user`);
    return;
  }
  const { priceId } = subscriptionDetails(sub);
  const plan = planForPriceId(priceId);

  if (sub.status === "active" || sub.status === "trialing") {
    if (!plan) {
      console.error(`[stripe] subscription ${sub.id}: price ${priceId} matches no plan; plan left unchanged`);
      return;
    }
    await saveSubscription(userId, sub, plan);
    await setUserPlan(userId, plan, `subscription ${sub.id} ${sub.status}`);
  } else if (sub.status === "canceled" || sub.status === "unpaid") {
    await saveSubscription(userId, sub, plan ?? DOWNGRADE_PLAN);
    await setUserPlan(userId, DOWNGRADE_PLAN, `subscription ${sub.id} ${sub.status}`);
  } else {
    // past_due, incomplete, paused…: record the status, keep the plan while Stripe retries.
    await saveSubscription(userId, sub, plan ?? DOWNGRADE_PLAN);
    console.warn(`[stripe] subscription ${sub.id} is ${sub.status}; user ${userId} plan unchanged`);
  }
}

async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const userId = await findUserForSubscription(sub);
  if (!userId) {
    console.warn(`[stripe] subscription ${sub.id} deleted but no matching user`);
    return;
  }
  const { priceId } = subscriptionDetails(sub);
  await saveSubscription(userId, sub, planForPriceId(priceId) ?? DOWNGRADE_PLAN);
  await setUserPlan(userId, DOWNGRADE_PLAN, `subscription ${sub.id} deleted`);
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    console.error("[stripe] webhook received but STRIPE_WEBHOOK_SECRET is not set");
    return Response.json({ ok: false, error: "Webhook not configured." }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    if (!signature) throw new Error("missing stripe-signature header");
    event = getStripe().webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.warn("[stripe] webhook signature check failed:", error instanceof Error ? error.message : error);
    return Response.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  const [seen] = await db.select({ id: stripeEvents.id }).from(stripeEvents).where(eq(stripeEvents.id, event.id)).limit(1);
  if (seen) return Response.json({ ok: true, duplicate: true });

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await onCheckoutCompleted(event.data.object);
        break;
      case "customer.subscription.updated":
        await onSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await onSubscriptionDeleted(event.data.object);
        break;
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        console.warn(`[stripe] payment failed: invoice ${invoice.id}, customer ${idOf(invoice.customer)}`);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    // Not recorded as processed, so Stripe's retry gets another chance.
    console.error(`[stripe] webhook ${event.type} ${event.id} failed:`, error);
    return Response.json({ ok: false, error: "Processing failed." }, { status: 500 });
  }

  await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
  return Response.json({ ok: true });
}
