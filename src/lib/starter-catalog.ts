/**
 * Starter catalog: 24 unbranded, low-VeRO-risk products.
 *
 * IMPORTANT: supplier costs and monthly sales here are EXAMPLE figures, not live
 * supplier quotes. Every screen that shows them labels them as sample prices.
 * Used by `npm run db:seed` and as the fallback when the catalog table is empty.
 *
 * No retailer (Amazon, Walmart, Home Depot…) is named as the supplier: eBay does
 * not allow filling an order by buying from another retailer or marketplace.
 */

/** Shown wherever a sample product's supplier would appear. */
export const SAMPLE_SUPPLIER = "Example wholesale supplier";
export type StarterRow = {
  externalId: string;
  title: string;
  category: string;
  supplierPrice: number;
  monthlySales: number;
  veroRisk: "low" | "medium" | "high";
};

export const STARTER_ROWS: StarterRow[] = [
  { externalId: "seed-001", title: "Adjustable Laptop Stand Aluminum Riser", category: "Home Office", supplierPrice: 18.4, monthlySales: 740, veroRisk: "low" },
  { externalId: "seed-002", title: "Cordless Electric Spin Scrubber Kit", category: "Home & Garden", supplierPrice: 27.9, monthlySales: 980, veroRisk: "low" },
  { externalId: "seed-003", title: "Magnetic Phone Mount for Car Dashboard", category: "Automotive", supplierPrice: 9.25, monthlySales: 1180, veroRisk: "low" },
  { externalId: "seed-004", title: "Memory Foam Lumbar Support Cushion", category: "Home Office", supplierPrice: 16.75, monthlySales: 620, veroRisk: "low" },
  { externalId: "seed-005", title: "Stainless Steel Insulated Tumbler 30oz", category: "Kitchen", supplierPrice: 11.2, monthlySales: 1320, veroRisk: "medium" },
  { externalId: "seed-006", title: "LED Motion Sensor Closet Light 3-Pack", category: "Lighting", supplierPrice: 13.6, monthlySales: 510, veroRisk: "low" },
  { externalId: "seed-007", title: "Heavy Duty Garden Hose Nozzle Brass", category: "Home & Garden", supplierPrice: 12.4, monthlySales: 390, veroRisk: "low" },
  { externalId: "seed-008", title: "Collapsible Silicone Food Storage Set", category: "Kitchen", supplierPrice: 21.3, monthlySales: 460, veroRisk: "low" },
  { externalId: "seed-009", title: "Resistance Band Set with Door Anchor", category: "Fitness", supplierPrice: 14.8, monthlySales: 870, veroRisk: "low" },
  { externalId: "seed-010", title: "Pet Hair Remover Roller Reusable", category: "Pet Supplies", supplierPrice: 8.9, monthlySales: 1040, veroRisk: "low" },
  { externalId: "seed-011", title: "Digital Kitchen Scale 11lb Backlit", category: "Kitchen", supplierPrice: 10.6, monthlySales: 700, veroRisk: "low" },
  { externalId: "seed-012", title: "Under-Desk Cable Management Tray", category: "Home Office", supplierPrice: 19.95, monthlySales: 340, veroRisk: "low" },
  { externalId: "seed-013", title: "Rechargeable Handheld Vacuum for Car", category: "Automotive", supplierPrice: 29.4, monthlySales: 560, veroRisk: "low" },
  { externalId: "seed-014", title: "Blackout Thermal Curtain Panel Pair", category: "Home & Garden", supplierPrice: 23.1, monthlySales: 410, veroRisk: "low" },
  { externalId: "seed-015", title: "Non-Slip Yoga Mat 6mm with Strap", category: "Fitness", supplierPrice: 17.25, monthlySales: 650, veroRisk: "low" },
  { externalId: "seed-016", title: "Solar Pathway Lights Outdoor 8-Pack", category: "Lighting", supplierPrice: 24.8, monthlySales: 930, veroRisk: "low" },
  { externalId: "seed-017", title: "Stackable Shoe Organizer Rack 3-Tier", category: "Storage", supplierPrice: 15.4, monthlySales: 480, veroRisk: "low" },
  { externalId: "seed-018", title: "Bamboo Bathtub Caddy Tray Expandable", category: "Bath", supplierPrice: 22.6, monthlySales: 300, veroRisk: "low" },
  { externalId: "seed-019", title: "Wireless Doorbell Chime Kit Waterproof", category: "Smart Home", supplierPrice: 20.15, monthlySales: 520, veroRisk: "medium" },
  { externalId: "seed-020", title: "Silicone Baking Mat Set Non-Stick", category: "Kitchen", supplierPrice: 9.85, monthlySales: 760, veroRisk: "low" },
  { externalId: "seed-021", title: "Portable Clothes Steamer Handheld", category: "Laundry", supplierPrice: 26.3, monthlySales: 590, veroRisk: "low" },
  { externalId: "seed-022", title: "Dog Car Seat Cover Waterproof Hammock", category: "Pet Supplies", supplierPrice: 18.9, monthlySales: 430, veroRisk: "low" },
  { externalId: "seed-023", title: "Over-Door Hook Rack Heavy Duty 5-Hook", category: "Storage", supplierPrice: 7.6, monthlySales: 820, veroRisk: "low" },
  { externalId: "seed-024", title: "Electric Milk Frother Handheld Stainless", category: "Kitchen", supplierPrice: 11.95, monthlySales: 680, veroRisk: "low" },
];
