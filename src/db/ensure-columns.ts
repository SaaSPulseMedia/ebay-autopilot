import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Columns added to existing tables after launch. Production is updated with
 * `drizzle-kit push`, so a deploy can reach a database that lacks them, and
 * every query selecting the table would then fail. Adding them here (only
 * when missing) keeps the schema and the database in step. Idempotent.
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; definition: string }> = [
  { table: "ebay_accounts", column: "fulfillment_policy_id", definition: "text" },
  { table: "ebay_accounts", column: "payment_policy_id", definition: "text" },
  { table: "ebay_accounts", column: "return_policy_id", definition: "text" },
  { table: "catalog_products", column: "images", definition: "jsonb NOT NULL DEFAULT '[]'::jsonb" },
  { table: "catalog_products", column: "variants", definition: "jsonb NOT NULL DEFAULT '[]'::jsonb" },
  { table: "catalog_products", column: "details", definition: "jsonb" },
];

export async function ensureAddedColumns(db: NodePgDatabase<Record<string, unknown>>) {
  const result = await db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = current_schema()
      and table_name in ('ebay_accounts', 'catalog_products')
  `);
  const present = new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`));
  const added: string[] = [];
  for (const { table, column, definition } of ADDED_COLUMNS) {
    if (present.has(`${table}.${column}`)) continue;
    // Identifiers come from the constant list above, never from input.
    await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`));
    added.push(`${table}.${column}`);
  }
  return { added };
}
