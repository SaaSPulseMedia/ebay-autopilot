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

/** Tables added after launch, created when missing (same reason as ADDED_COLUMNS). */
const ADDED_TABLES: Array<{ table: string; ddl: string }> = [
  {
    table: "product_images",
    ddl: `CREATE TABLE IF NOT EXISTS product_images (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      external_id text NOT NULL,
      images jsonb NOT NULL DEFAULT '[]'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, external_id)
    )`,
  },
  {
    table: "uploaded_images",
    ddl: `CREATE TABLE IF NOT EXISTS uploaded_images (
      id text PRIMARY KEY,
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content_type text NOT NULL DEFAULT 'image/jpeg',
      data text NOT NULL,
      width integer NOT NULL,
      height integer NOT NULL,
      bytes integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
];

export async function ensureAddedColumns(db: NodePgDatabase<Record<string, unknown>>) {
  const tables = await db.execute<{ table_name: string }>(sql`
    select table_name from information_schema.tables where table_schema = current_schema()
  `);
  const existing = new Set(tables.rows.map((r) => r.table_name));
  const added: string[] = [];
  for (const { table, ddl } of ADDED_TABLES) {
    if (existing.has(table)) continue;
    // DDL comes from the constant list above, never from input.
    await db.execute(sql.raw(ddl));
    added.push(table);
  }

  const result = await db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name from information_schema.columns
    where table_schema = current_schema()
      and table_name in ('ebay_accounts', 'catalog_products')
  `);
  const present = new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`));
  for (const { table, column, definition } of ADDED_COLUMNS) {
    if (present.has(`${table}.${column}`)) continue;
    // Identifiers come from the constant list above, never from input.
    await db.execute(sql.raw(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`));
    added.push(`${table}.${column}`);
  }
  return { added };
}
