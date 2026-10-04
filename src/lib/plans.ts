export type Plan = {
  id: "starter" | "pro" | "business";
  name: string;
  price: number;
  cadence: string;
  tagline: string;
  bulkLimit: string;
  features: string[];
  highlight?: boolean;
};

/**
 * Active-listing caps are the upgrade driver, so they are deliberately tight.
 * Batch size is always well below the active cap — you can never bulk-list
 * more products in one run than your plan can hold.
 */
export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 19.99,
    cadence: "/month",
    tagline: "Try the listing engine on one store.",
    bulkLimit: "Bulk list 10 products per run",
    features: [
      "1 eBay store",
      "50 active listings",
      "Bulk list up to 10 products per run",
      "AI listing copy (title, specifics, description)",
      "Variant generation up to 20 per product",
      "Winning-product research feed",
      "Hourly supplier price checks",
      "Email support",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 49.99,
    cadence: "/month",
    tagline: "Unlimited bulk runs. This is the one that replaces the VA.",
    bulkLimit: "Unlimited bulk runs, 50 products per run",
    features: [
      "3 eBay stores",
      "200 active listings",
      "Unlimited bulk runs, up to 50 products each",
      "Unlimited variants per product",
      "Scheduled drip posting (stealth cadence)",
      "Automatic repricing rules",
      "Out-of-stock auto-pause",
      "VeRO keyword shield",
      "Order + tracking sync",
      "Priority support",
    ],
    highlight: true,
  },
  {
    id: "business",
    name: "Business",
    price: 89.99,
    cadence: "/month",
    tagline: "Multi-store operators and small teams.",
    bulkLimit: "Unlimited bulk runs, 200 products per run",
    features: [
      "10 eBay stores",
      "1,000 active listings",
      "Unlimited bulk runs, up to 200 products each",
      "Unlimited variants per product",
      "Bulk CSV + URL import",
      "Team seats with per-store access",
      "Custom pricing formulas",
      "API access",
      "Same-business-day support",
    ],
  },
];
