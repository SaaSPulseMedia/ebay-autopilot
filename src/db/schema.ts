import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { ProductFacts } from "../lib/cj/facts";

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
  /** Business policies the seller picked in Settings; null = use their first policy of each kind. */
  fulfillmentPolicyId: text("fulfillment_policy_id"),
  paymentPolicyId: text("payment_policy_id"),
  returnPolicyId: text("return_policy_id"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One supplier variant (e.g. CJ "Black-36"), as imported. `price` is the supplier cost in USD. */
export type CatalogVariant = {
  sku: string;
  name: string;
  key: string;
  color: string | null;
  size: string | null;
  image: string;
  price: number;
  weightGrams: number;
  barcode: string;
};

/** Supplier catalog rows powering the winning-products research view. */
export const catalogProducts = pgTable(
  "catalog_products",
  {
    id: serial("id").primaryKey(),
    /** Owning seller. Null for the shared sample products every seller sees. */
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    source: text("source").notNull().default("seed"),
    title: text("title").notNull(),
    category: text("category").notNull().default("General"),
    supplier: text("supplier").notNull().default("Unknown supplier"),
    supplierUrl: text("supplier_url"),
    /** Primary image (first of `images`), kept for screens that show one thumbnail. */
    imageUrl: text("image_url"),
    /** Every product image, primary first (CJ imports carry 5–10). Empty for older rows. */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    /** Real supplier variants (CJ imports). Empty for single-variant and older rows. */
    variants: jsonb("variants").$type<CatalogVariant[]>().notNull().default([]),
    /** Supplier facts for listing copy (CJ imports); null for older and sample rows. */
    details: jsonb("details").$type<ProductFacts>(),
    supplierPrice: numeric("supplier_price", { precision: 10, scale: 2 }).notNull(),
    suggestedPrice: numeric("suggested_price", { precision: 10, scale: 2 }).notNull(),
    shippingCost: numeric("shipping_cost", { precision: 10, scale: 2 }).notNull().default("0"),
    monthlySales: integer("monthly_sales").notNull().default(0),
    competition: text("competition").notNull().default("medium"),
    veroRisk: text("vero_risk").notNull().default("low"),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // One row per seller per product; shared rows (no owner) are unique on their own.
  (table) => [
    uniqueIndex("catalog_products_user_external_unique")
      .on(table.userId, table.externalId)
      .where(sql`user_id is not null`),
    uniqueIndex("catalog_products_shared_external_unique").on(table.externalId).where(sql`user_id is null`),
  ],
);

/**
 * A seller's own image list for a catalog product (custom order, removed
 * photos, their uploads). Kept apart from catalog_products so edits survive
 * a CJ refresh. No row = supplier images.
 */
export const productImages = pgTable(
  "product_images",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    /** Public image URLs, main image first (max 24, eBay's limit). */
    images: jsonb("images").$type<string[]>().notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.externalId] })],
);

/** Images sellers upload, served publicly at /api/images/<id>.jpg so eBay can fetch them. */
export const uploadedImages = pgTable("uploaded_images", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  contentType: text("content_type").notNull().default("image/jpeg"),
  /** Base64 image bytes (already resized and re-encoded). */
  data: text("data").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  bytes: integer("bytes").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

/** One Stripe subscription per user. users.plan stays the field the app reads; the webhook keeps it in sync. */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  stripeCustomerId: text("stripe_customer_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id").unique(),
  plan: text("plan").notNull(),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Stripe webhook events already processed (Stripe can deliver the same event more than once). */
export const stripeEvents = pgTable("stripe_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});
