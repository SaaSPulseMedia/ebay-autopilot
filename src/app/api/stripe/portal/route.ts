import { getCurrentUser } from "@/lib/auth";
import { getStripe, isStripeConfigured } from "@/lib/stripe/client";
import { getSubscriptionForUser } from "@/lib/stripe/subscriptions";

export const dynamic = "force-dynamic";

/** Opens the Stripe Customer Portal (change plan, cancel, update card) for the signed-in user. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Not signed in." }, { status: 401 });
  if (!isStripeConfigured()) return Response.json({ ok: false, error: "Billing is in demo mode." }, { status: 503 });

  const subscription = await getSubscriptionForUser(user.id);
  if (!subscription) return Response.json({ ok: false, error: "You don't have a subscription yet." }, { status: 404 });

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: subscription.stripeCustomerId,
      return_url: `${baseUrl}/dashboard/billing`,
    });
    return Response.json({ ok: true, url: session.url });
  } catch (error) {
    console.error(`[stripe] portal failed for user ${user.id}:`, error);
    return Response.json({ ok: false, error: "Could not open the billing portal. Please try again." }, { status: 502 });
  }
}
