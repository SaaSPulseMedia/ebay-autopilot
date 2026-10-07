import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    storeName: text("store_name"),
    plan: text("plan").notNull().default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_email_unique").on(table.email)],
);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** eBay store connections. OAuth mode stores tokens; browser mode stores an encrypted blob. */
export const ebayAccounts = pgTable("ebay_accounts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  label: text("label").notNull().default("My eBay store"),
  mode: text("mode").notNull().default("demo"), // 'oauth' | 'browser' | 'demo'
  ebayUserId: text("ebay_user_id"),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  /** AES-256-GCM ciphertext, only populated for the browser-fallback engine. */
  encryptedCredentials: text("encrypted_credentials"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Supplier catalog rows powering the winning-products research view. */
export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: serial("id").primaryKey(),
    externalId: text("external_id").notNull(),
    source: text("source").notNull().default("seed"),
    title: text("title").notNull(),
    category: text("category").notNull().default("General"),
    supplier: text("supplier").notNull().default("Unknown supplier"),
    supplierUrl: text("supplier_url"),
    imageUrl: text("image_url"),
    supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }).notNull(),
    suggestedPrice: numeric("suggested_price", { precision: 10, scale: 2 }).notNull(),
    shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0"),
    monthlySales: integer("monthly_sales").notNull().default(0),
    competition: text("competition").notNull().default("medium"),
    veroRisk: text("vero_risk").notNull().default("low"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("catalog_products_external_unique").on(table.externalId)],
);

export const listings = pgTable("listings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  sourceUrl: text("source_url"),
  imageUrl: text("image_url"),
  supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }).notNull().default("0"),
  listPrice: numeric("list_price", { precision: 10, scale: 2 }).notNull().default("0"),
  engine: text("engine").notNull().default("demo"), // 'api' | 'browser' | 'demo'
  status: text("status").notNull().default("draft"),
  ebayItemId: text("ebay_item_id"),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  variantCount: integer("variant_count").notNull().default(1),
  batchId: text("batch_id"),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  listingId: integer("listing_id").references(() => listings.id, { onDelete: "set null" }),
  buyerName: text("buyer_name").notNull().default("eBay buyer"),
  salePrice: numeric("sale_price", { precision: 10, scale: 2 }).notNull().default("0"),
  cost: numeric("cost", { precision: 10, scale: 2 }).notNull().default("0"),
  status: text("status").notNull().default("awaiting_fulfillment"),
  trackingNumber: text("tracking_number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-seller listing defaults, applied to every new listing (bulk, paste links, single). */
export const sellerSettings = pgTable("seller_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  pricingMode: text("pricing_mode").notNull().default("suggested"), // 'suggested' | 'markup'
  markupPct: integer("markup_pct").notNull().default(40),
  adRatePct: real("ad_rate_pct").notNull().default(0),
  quantityPerVariant: integer("quantity_per_variant").notNull().default(10),
  handlingDays: integer("handling_days").notNull().default(2),
  descriptionFooter: text("description_footer").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
