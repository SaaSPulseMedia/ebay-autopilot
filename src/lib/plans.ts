export type PlanFeature = {
  label: string;
  /** Not built yet — shown with an "In progress" tag, never as a shipped feature. */
  inProgress?: boolean;
};

export type Plan = {
  id: "starter" | "pro" | "business";
  name: string;
  price: number;
  cadence: string;
  tagline: string;
  bulkLimit: string;
  features: PlanFeature[];
  highlight?: boolean;
};

/**
 * LOCKED pricing: $19.99 / $49.99 / $89.99 for 50 / 200 / 1,000 active listings
 * and 1 / 3 / 10 stores. Bulk publishing (50 per run) and up to 20 variants per
 * product are included in every plan — plans differ by listing capacity.
 */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 19.99,
    cadence: "/month",
    tagline: "Try the listing engine on one store.",
    bulkLimit: "Bulk list up to 50 products per run",
    features: [
      { label: "1 eBay store" },
      { label: "50 active listings" },
      { label: "Bulk list up to 50 products per run" },
      { label: "Up to 20 variants per product" },
      { label: "AI listing copy (title, specifics, description)" },
      { label: "Brand-name (VeRO) screening on every listing" },
      { label: "Product research with profit after eBay fees" },
      { label: "Email support" },
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49.99,
    cadence: "/month",
    tagline: "4× the listings of Starter, for sellers who list every day.",
    bulkLimit: "Bulk list up to 50 products per run",
    features: [
      { label: "3 eBay stores" },
      { label: "200 active listings" },
      { label: "Bulk list up to 50 products per run" },
      { label: "Up to 20 variants per product" },
      { label: "Everything in Starter" },
      { label: "Priority support" },
      { label: "Drip posting — batches released up to 10 per hour" },
      { label: "Automatic repricing rules", inProgress: true },
      { label: "Out-of-stock auto-pause", inProgress: true },
      { label: "Order + tracking sync from eBay", inProgress: true },
    ],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    price: 89.99,
    cadence: "/month",
    tagline: "Multi-store operators and small teams.",
    bulkLimit: "Bulk list up to 50 products per run",
    features: [
      { label: "10 eBay stores" },
      { label: "1,000 active listings" },
      { label: "Bulk list up to 50 products per run" },
      { label: "Up to 20 variants per product" },
      { label: "Everything in Pro" },
      { label: "Same-business-day support" },
      { label: "Bulk CSV import", inProgress: true },
      { label: "Team seats with per-store access", inProgress: true },
      { label: "Custom pricing formulas", inProgress: true },
      { label: "API access", inProgress: true },
    ],
  },
];
