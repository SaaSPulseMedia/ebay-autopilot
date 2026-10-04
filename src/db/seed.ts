import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { catalogProducts } from "./schema";

const EBAY_FINAL_VALUE_FEE = 0.1355;
const EBAY_FIXED_FEE = 0.4;

type SeedRow = {
  externalId: string;
  title: string;
  category: string;
  supplier: string;
  supplierPrice: number;
  monthlySales: number;
  veroRisk: "low" | "medium" | "high";
};

const rows: SeedRow[] = [
  { externalId: "seed-001", title: "Adjustable Laptop Stand Aluminum Riser", category: "Home Office", supplier: "Amazon US", supplierPrice: 18.4, monthlySales: 740, veroRisk: "low" },
  { externalId: "seed-002", title: "Cordless Electric Spin Scrubber Kit", category: "Home & Garden", supplier: "Amazon US", supplierPrice: 27.9, monthlySales: 980, veroRisk: "low" },
  { externalId: "seed-003", title: "Magnetic Phone Mount for Car Dashboard", category: "Automotive", supplier: "Walmart US", supplierPrice: 9.25, monthlySales: 1180, veroRisk: "low" },
  { externalId: "seed-004", title: "Memory Foam Lumbar Support Cushion", category: "Home Office", supplier: "Amazon US", supplierPrice: 16.75, monthlySales: 620, veroRisk: "low" },
  { externalId: "seed-005", title: "Stainless Steel Insulated Tumbler 30oz", category: "Kitchen", supplier: "Walmart US", supplierPrice: 11.2, monthlySales: 1320, veroRisk: "medium" },
  { externalId: "seed-006", title: "LED Motion Sensor Closet Light 3-Pack", category: "Lighting", supplier: "Amazon US", supplierPrice: 13.6, monthlySales: 510, veroRisk: "low" },
  { externalId: "seed-007", title: "Heavy Duty Garden Hose Nozzle Brass", category: "Home & Garden", supplier: "Home Depot US", supplierPrice: 12.4, monthlySales: 390, veroRisk: "low" },
  { externalId: "seed-008", title: "Collapsible Silicone Food Storage Set", category: "Kitchen", supplier: "Amazon US", supplierPrice: 21.3, monthlySales: 460, veroRisk: "low" },
  { externalId: "seed-009", title: "Resistance Band Set with Door Anchor", category: "Fitness", supplier: "Walmart US", supplierPrice: 14.8, monthlySales: 870, veroRisk: "low" },
  { externalId: "seed-010", title: "Pet Hair Remover Roller Reusable", category: "Pet Supplies", supplier: "Amazon US", supplierPrice: 8.9, monthlySales: 1040, veroRisk: "low" },
  { externalId: "seed-011", title: "Digital Kitchen Scale 11lb Backlit", category: "Kitchen", supplier: "Walmart US", supplierPrice: 10.6, monthlySales: 700, veroRisk: "low" },
  { externalId: "seed-012", title: "Under-Desk Cable Management Tray", category: "Home Office", supplier: "Amazon US", supplierPrice: 19.95, monthlySales: 340, veroRisk: "low" },
  { externalId: "seed-013", title: "Rechargeable Handheld Vacuum for Car", category: "Automotive", supplier: "Amazon US", supplierPrice: 29.4, monthlySales: 560, veroRisk: "low" },
  { externalId: "seed-014", title: "Blackout Thermal Curtain Panel Pair", category: "Home & Garden", supplier: "Walmart US", supplierPrice: 23.1, monthlySales: 410, veroRisk: "low" },
  { externalId: "seed-015", title: "Non-Slip Yoga Mat 6mm with Strap", category: "Fitness", supplier: "Walmart US", supplierPrice: 17.25, monthlySales: 650, veroRisk: "low" },
  { externalId: "seed-016", title: "Solar Pathway Lights Outdoor 8-Pack", category: "Lighting", supplier: "Home Depot US", supplierPrice: 24.8, monthlySales: 930, veroRisk: "low" },
  { externalId: "seed-017", title: "Stackable Shoe Organizer Rack 3-Tier", category: "Storage", supplier: "Walmart US", supplierPrice: 15.4, monthlySales: 480, veroRisk: "low" },
  { externalId: "seed-018", title: "Bamboo Bathtub Caddy Tray Expandable", category: "Bath", supplier: "Amazon US", supplierPrice: 22.6, monthlySales: 300, veroRisk: "low" },
  { externalId: "seed-019", title: "Wireless Doorbell Chime Kit Waterproof", category: "Smart Home", supplier: "Amazon US", supplierPrice: 20.15, monthlySales: 520, veroRisk: "medium" },
  { externalId: "seed-020", title: "Silicone Baking Mat Set Non-Stick", category: "Kitchen", supplier: "Walmart US", supplierPrice: 9.85, monthlySales: 760, veroRisk: "low" },
  { externalId: "seed-021", title: "Portable Clothes Steamer Handheld", category: "Laundry", supplier: "Amazon US", supplierPrice: 26.3, monthlySales: 590, veroRisk: "low" },
  { externalId: "seed-022", title: "Dog Car Seat Cover Waterproof Hammock", category: "Pet Supplies", supplier: "Walmart US", supplierPrice: 18.9, monthlySales: 430, veroRisk: "low" },
  { externalId: "seed-023", title: "Over-Door Hook Rack Heavy Duty 5-Hook", category: "Storage", supplier: "Home Depot US", supplierPrice: 7.6, monthlySales: 820, veroRisk: "low" },
  { externalId: "seed-024", title: "Electric Milk Frother Handheld Stainless", category: "Kitchen", supplier: "Amazon US", supplierPrice: 11.95, monthlySales: 680, veroRisk: "low" },
];

function priceForEbay(cost: number) {
  const shipping = cost < 25 ? 4.25 : 0;
  const target = (cost + shipping + EBAY_FIXED_FEE) / (1 - EBAY_FINAL_VALUE_FEE - 0.23);
  const suggested = Math.max(cost + 6, Math.round(target * 100) / 100);
  return { shipping, suggested: Math.round(suggested * 100) / 100 };
}

function competitionFor(sales: number) {
  if (sales > 900) return "high";
  if (sales > 350) return "medium";
  return "low";
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  for (const row of rows) {
    const { shipping, suggested } = priceForEbay(row.supplierPrice);
    await db
      .insert(catalogProducts)
      .values({
        externalId: row.externalId,
        source: "seed",
        title: row.title,
        category: row.category,
        supplier: row.supplier,
        supplierPrice: row.supplierPrice.toFixed(2),
        suggestedPrice: suggested.toFixed(2),
        shippingCost: shipping.toFixed(2),
        monthlySales: row.monthlySales,
        competition: competitionFor(row.monthlySales),
        veroRisk: row.veroRisk,
      })
      .onConflictDoUpdate({
        target: catalogProducts.externalId,
        set: {
          supplierPrice: row.supplierPrice.toFixed(2),
          suggestedPrice: suggested.toFixed(2),
          shippingCost: shipping.toFixed(2),
          monthlySales: row.monthlySales,
          refreshedAt: new Date(),
        },
      });
  }

  console.log(`Seeded ${rows.length} catalog products.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
