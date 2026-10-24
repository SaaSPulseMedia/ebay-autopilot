/**
 * Why the sourcing checker turned a product down (sourcing_candidates.reason),
 * with the label the seller sees. Shared by the server checker and the page.
 */
export const REJECT_REASONS = {
  too_expensive: "too expensive vs eBay",
  low_profit: "under $5 profit",
  no_shipping: "no US shipping from CJ",
  variants: "sizes or variants eBay won't take",
  brand: "brand risk (VeRO)",
  bad_data: "missing CJ data",
} as const;

export type RejectReason = keyof typeof REJECT_REASONS;

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && value in REJECT_REASONS;
}
