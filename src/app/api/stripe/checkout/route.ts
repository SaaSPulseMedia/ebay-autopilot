import { getCurrentUser } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { isPlanId, stripePlans } from "@/lib/stripe/plans";
import { getSubscriptionForUser, isLiveSubscription } from "@/lib/stripe/subscriptions";

export const dynamic = "force-dynamic";

/**
 * Starts a Stripe Checkout subscription for the signed-in user. The plan only
 * changes later, when the verified webhook confirms payment.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });

  if (!isStripeConfigured()) {
    return Response.json(
      { ok: false, demo: true, error: "Billing is in demo mode — Stripe isn't set up on this deployment, so no plan was changed." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { planId?: unknown };
  if (!isPlanId(body.planId)) return Response.json({ ok: false, error: "Unknown plan." }, { status: 400 });
  const plan = stripePlans()[body.planId];
  if (!plan.stripePriceId) {
    console.error(`[stripe] checkout: no price ID set for ${plan.id}`);
    return Response.json({ ok: false, error: `The ${plan.name} plan isn't available yet. Please try again later.` }, { status: 503 });
  }

  // A second Checkout would create a second subscription; plan changes go through the portal.
  if (isLiveSubscription(await getSubscriptionForUser(user.id))) {
    return Response.json(
      { ok: false, error: "You already have a subscription. Use “Manage subscription” to change or cancel your plan." },
      { status: 409 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  const metadata = { userId: String(user.id), planId: plan.id };
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard/billing?status=success`,
      cancel_url: `${baseUrl}/dashboard/billing?status=cancelled`,
      client_reference_id: String(user.id),
      customer_email: user.email,
      metadata,
      // Copied onto the subscription so later webhooks can find the user even without our row.
      subscription_data: { metadata },
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL.");
    return Response.json({ ok: true, url: session.url });
  } catch (error) {
    console.error(`[stripe] checkout failed for user ${user.id}:`, error);
    return Response.json({ ok: false, error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
