import "server-only";

import { planLimits } from "@/lib/limits";
import { PLANS, type Plan } from "@/lib/plans";

/**
 * The three paid plans as Stripe sees them. Name and price come from
 * src/lib/plans.ts and the listing limit from src/lib/limits.ts, so the locked
 * pricing lives in one place; only the Stripe price IDs come from env vars.
 */
export type StripePlan = {
  id: Plan["id"];
  name: string;
  priceUsd: number;
  stripePriceId: string | null;
  listingLimit: number;
};

const PRICE_ENV: Record<Plan["id"], string> = {
  starter: "STRIPE_PRICE_STARTER",
  pro: "STRIPE_PRICE_PRO",
  business: "STRIPE_PRICE_BUSINESS",
};

function plan(id: Plan["id"]): StripePlan {
  const base = PLANS.find((p) => p.id === id) as Plan;
  return {
    id,
    name: base.name,
    priceUsd: base.price,
    stripePriceId: process.env[PRICE_ENV[id]]?.trim() || null,
    listingLimit: planLimits(id).activeListings,
  };
}

export function stripePlans(): Record<Plan["id"], StripePlan> {
  return { starter: plan("starter"), pro: plan("pro"), business: plan("business") };
}

export function isPlanId(value: unknown): value is Plan["id"] {
  return value === "starter" || value === "pro" || value === "business";
}

/** Which plan a Stripe price ID belongs to, or null if it isn't one of ours. */
export function planForPriceId(priceId: string | null | undefined): Plan["id"] | null {
  if (!priceId) return null;
  return Object.values(stripePlans()).find((p) => p.stripePriceId === priceId)?.id ?? null;
}

export const PRICE_ENV_VARS = Object.values(PRICE_ENV);
