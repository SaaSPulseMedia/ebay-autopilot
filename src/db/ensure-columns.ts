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
  { table: "ebay_accounts", column: "free_shipping_policy_id", definition: "text" },
  { table: "ebay_accounts", column: "scopes", definition: "text" },
  { table: "ebay_accounts", column: "promo_campaign_id", definition: "text" },
  { table: "catalog_products", column: "images", definition: "jsonb NOT NULL DEFAULT '[]'::jsonb" },
  { table: "catalog_products", column: "variants", definition: "jsonb NOT NULL DEFAULT '[]'::jsonb" },
  { table: "catalog_products", column: "details", definition: "jsonb" },
  { table: "catalog_products", column: "user_id", definition: "integer REFERENCES users(id) ON DELETE CASCADE" },
  { table: "catalog_products", column: "shipping_quoted_at", definition: "timestamptz" },
  { table: "seller_settings", column: "ebay_fee_pct", definition: "real NOT NULL DEFAULT 13.55" },
  { table: "seller_settings", column: "fx_pct", definition: "real NOT NULL DEFAULT 0" },
  { table: "sourcing_candidates", column: "ebay_sold", definition: "integer" },
  { table: "sourcing_candidates", column: "ebay_listings", definition: "integer" },
  { table: "cj_orders", column: "auto", definition: "boolean NOT NULL DEFAULT false" },
  { table: "cj_orders", column: "paid_at", definition: "timestamptz" },
  { table: "cj_orders", column: "note", definition: "text" },
];

/**
 * catalog_products became per-seller: unique per (user_id, external_id), with
 * ownerless sample rows unique on external_id alone. The new indexes are built
 * before the old global one is dropped, so imports never run unprotected.
 */
const CATALOG_INDEXES: Array<{ name: string; ddl: string }> = [
  {
    name: "catalog_products_user_external_unique",
    ddl: "CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_user_external_unique ON catalog_products (user_id, external_id) WHERE user_id IS NOT NULL",
  },
  {
    name: "catalog_products_shared_external_unique",
    ddl: "CREATE UNIQUE INDEX IF NOT EXISTS catalog_products_shared_external_unique ON catalog_products (external_id) WHERE user_id IS NULL",
  },
];
const OLD_CATALOG_INDEX = "catalog_products_external_unique";

/**
 * CJ products imported while the catalog was shared belong to the store's
 * original seller. New imports always carry an owner, so after the first run
 * this matches nothing; it stays idempotent and is a no-op if that account
 * doesn't exist.
 */
const LEGACY_CATALOG_OWNER_EMAIL = "itsy@store.com";

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
    table: "seen_products",
    ddl: `CREATE TABLE IF NOT EXISTS seen_products (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pid text NOT NULL,
      niche text NOT NULL DEFAULT '',
      keyword text NOT NULL DEFAULT '',
      outcome text NOT NULL DEFAULT 'shown',
      seen_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, pid)
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
  {
    table: "sourcing_candidates",
    ddl: `CREATE TABLE IF NOT EXISTS sourcing_candidates (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pid text NOT NULL,
      niche text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'queued',
      reason text,
      detail text,
      title text NOT NULL DEFAULT '',
      image_url text,
      listed_num integer NOT NULL DEFAULT 0,
      score real NOT NULL DEFAULT 0,
      cost numeric(10, 2),
      shipping numeric(10, 2),
      list_price numeric(10, 2),
      profit numeric(10, 2),
      market numeric(10, 2),
      variant_count integer NOT NULL DEFAULT 1,
      ebay_category text,
      found_at timestamptz NOT NULL DEFAULT now(),
      checked_at timestamptz,
      PRIMARY KEY (user_id, pid)
    )`,
  },
  {
    table: "sourcing_settings",
    ddl: `CREATE TABLE IF NOT EXISTS sourcing_settings (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      niches jsonb NOT NULL DEFAULT '[]'::jsonb,
      enabled boolean NOT NULL DEFAULT true,
      last_run_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
  },
  {
    table: "cj_orders",
    ddl: `CREATE TABLE IF NOT EXISTS cj_orders (
      user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ebay_order_id text NOT NULL,
      cj_order_id text,
      cj_order_number text NOT NULL,
      sandbox boolean NOT NULL DEFAULT false,
      status text NOT NULL DEFAULT 'created',
      cj_status text,
      logistic_name text,
      from_country text,
      amount numeric(10, 2),
      tracking_number text,
      carrier text,
      ebay_shipped_at timestamptz,
      error text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, ebay_order_id)
    )`,
  },
  {
    table: "auto_order_settings",
    ddl: `CREATE TABLE IF NOT EXISTS auto_order_settings (
      user_id integer PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      mode text NOT NULL DEFAULT 'off',
      max_order real NOT NULL DEFAULT 40,
      max_day real NOT NULL DEFAULT 150,
      enabled_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
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
  const indexes = await db.execute<{ indexname: string }>(sql`
    select indexname from pg_indexes where schemaname = current_schema() and tablename = 'catalog_products'
  `);
  const indexNames = new Set(indexes.rows.map((r) => r.indexname));
  for (const { name, ddl } of CATALOG_INDEXES) {
    if (indexNames.has(name)) continue;
    await db.execute(sql.raw(ddl));
    added.push(`index ${name}`);
  }
  if (indexNames.has(OLD_CATALOG_INDEX)) {
    await db.execute(sql.raw(`DROP INDEX IF EXISTS ${OLD_CATALOG_INDEX}`));
    added.push(`dropped index ${OLD_CATALOG_INDEX}`);
  }

  const backfill = await db.execute(sql`
    update catalog_products set user_id = (select id from users where email = ${LEGACY_CATALOG_OWNER_EMAIL})
    where user_id is null and source = 'cj'
      and exists (select 1 from users where email = ${LEGACY_CATALOG_OWNER_EMAIL})
  `);
  const catalogRowsAssigned = backfill.rowCount ?? 0;
  return { added, catalogRowsAssigned };
}
