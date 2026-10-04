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

/** Batch size is always well under the active cap so a single run can never overfill a plan. */
const TABLE: Record<Plan["id"], Omit<PlanLimits, "planId" | "planName" | "isTrial">> = {
  starter: { batchSize: 10, activeListings: 50, maxVariants: 20 },
  pro: { batchSize: 50, activeListings: 200, maxVariants: 200 },
  business: { batchSize: 200, activeListings: 1000, maxVariants: 200 },
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
