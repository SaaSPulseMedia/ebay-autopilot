import "server-only";

import Stripe from "stripe";

/** True when a Stripe secret key is set; otherwise billing runs in demo mode. */
export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

let client: Stripe | null = null;

/** Server-side Stripe SDK. Throws a clear error when STRIPE_SECRET_KEY is missing. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set, so billing is in demo mode.");
  client ??= new Stripe(key);
  return client;
}
