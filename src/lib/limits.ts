import { PLANS, type Plan } from "./plans";

export type PlanLimits = {
  planId: Plan["id"];
  planName: string;
  /** Maximum products that can be published in a single bulk run. */
  batchSize: number;
  /** Maximum active listings the account may hold at once. */
  activeListings: number;
  /** Maximum variant rows generated per product. */
  maxVariants: number;
  /** Trial accounts get Starter capability so the feature is testable. */
  isTrial: boolean;
};

/**
 * Locked product rules: bulk publishing of 50 per run and up to 20 variants per
 * product are included in EVERY plan. Plans differ only by active listings and stores.
 */
export const BATCH_SIZE = 50;
export const MAX_VARIANTS = 20;

const TABLE: Record<Plan["id"], Omit<PlanLimits, "planId" | "planName" | "isTrial">> = {
  starter: { batchSize: BATCH_SIZE, activeListings: 50, maxVariants: MAX_VARIANTS },
  pro: { batchSize: BATCH_SIZE, activeListings: 200, maxVariants: MAX_VARIANTS },
  business: { batchSize: BATCH_SIZE, activeListings: 1000, maxVariants: MAX_VARIANTS },
};

export function planLimits(plan: string): PlanLimits {
  const isTrial = plan === "trial" || !PLANS.some((p) => p.id === plan);
  const planId = (isTrial ? "starter" : plan) as Plan["id"];
  const named = PLANS.find((p) => p.id === planId) ?? PLANS[0];
  return { planId, planName: named.name, isTrial, ...TABLE[planId] };
}

/** Plan to suggest when someone hits a ceiling. */
export function nextPlanUp(planId: Plan["id"]): Plan | null {
  if (planId === "starter") return PLANS.find((p) => p.id === "pro") ?? null;
  if (planId === "pro") return PLANS.find((p) => p.id === "business") ?? null;
  return null;
}
