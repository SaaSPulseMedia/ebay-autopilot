import "server-only";

import { PLANS, type Plan } from "./plans";

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export type CheckoutResult = { url: string; demo: boolean; message: string };

/**
 * Stripe Checkout with a demo fallback so the flow is always clickable
 * before live keys are added. The secret key never leaves the server.
 */
export async function createCheckoutSession(planId: Plan["id"], baseUrl: string): Promise<CheckoutResult> {
  const plan = PLANS.find((p) => p.id === planId) ?? PLANS[0];
  if (!isStripeConfigured()) {
    return {
      url: `/dashboard/billing?demo=${plan.id}`,
      demo: true,
      message: `Stripe keys are not configured on this deployment, so the ${plan.name} checkout ran in demo mode. Nothing was charged.`,
    };
  }

  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(Math.round(plan.price * 100)),
    "line_items[0][price_data][recurring][interval]": "month",
    "line_items[0][price_data][product_data][name]": `eBay AutoPilot ${plan.name}`,
    success_url: `${baseUrl}/dashboard/billing?status=success`,
    cancel_url: `${baseUrl}/dashboard/billing?status=cancelled`,
  });

  try {
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      return {
        url: "/dashboard/billing?error=1",
        demo: false,
        message: json.error?.message ?? "Stripe rejected the checkout session.",
      };
    }
    return { url: json.url, demo: false, message: "Redirecting to Stripe Checkout." };
  } catch {
    return { url: "/dashboard/billing?error=1", demo: false, message: "Could not reach Stripe." };
  }
}

export { PLANS };
export type { Plan };
