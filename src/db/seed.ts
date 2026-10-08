import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { competitionFor, priceForEbay } from "../lib/pricing";
import { SAMPLE_SUPPLIER, STARTER_ROWS, starterImageUrl } from "../lib/starter-catalog";
import { backfillStarterImages } from "./backfill-images";
import { catalogProducts } from "./schema";

/** Loads the 24 starter products (example prices). Safe to run more than once. */
async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString });
  const db = drizzle(pool);

  for (const row of STARTER_ROWS) {
    const { shipping, suggested } = priceForEbay(row.supplierPrice);
    await db
      .insert(catalogProducts)
      .values({
        externalId: row.externalId,
        source: "seed",
        title: row.title,
        category: row.category,
        supplier: SAMPLE_SUPPLIER,
        imageUrl: starterImageUrl(row.title),
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
          supplier: SAMPLE_SUPPLIER,
          supplierPrice: row.supplierPrice.toFixed(2),
          suggestedPrice: suggested.toFixed(2),
          shippingCost: shipping.toFixed(2),
          monthlySales: row.monthlySales,
          refreshedAt: new Date(),
        },
      });
  }

  // Existing rows keep any image they already have; only missing ones are filled.
  const images = await backfillStarterImages(db);
  console.log(`Seeded ${STARTER_ROWS.length} catalog products; added images to ${images.updated}.`);
  await pool.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
