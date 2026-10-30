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
  /** Free-shipping fulfillment policy used by "Match eBay Market Price (Free Shipping)" (found or created by AutoPilot). */
  freeShippingPolicyId: text("free_shipping_policy_id"),
  /** OAuth scopes granted at connection (space-separated); null = connected before these were saved. */
  scopes: text("scopes"),
  /** AutoPilot's Promoted Listings (General) campaign on this store, once created. */
  promoCampaignId: text("promo_campaign_id"),
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
    /** When `shippingCost` was last quoted by CJ's freight calculator; null = an old flat estimate. */
    shippingQuotedAt: timestamp("shipping_quoted_at", { withTimezone: true }),
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
/**
 * Every CJ product "✨ Auto-Suggest Winners" has shown a seller (or dropped
 * for them at the Market Guard), so later runs skip it and only show fresh
 * products. `keyword` and `niche` also tell Claude which keywords it already
 * used. Kept per seller; the Winning page can clear it.
 */
export const seenProducts = pgTable(
  "seen_products",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pid: text("pid").notNull(),
    niche: text("niche").notNull().default(""),
    keyword: text("keyword").notNull().default(""),
    /** "shown" in the feed, "rejected" by the Market Guard (eBay sells it below break-even), or "dismissed" by the seller. */
    outcome: text("outcome").notNull().default("shown"),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pid] })],
);

/**
 * The sourcing checker's work list and results, one row per seller per CJ
 * product (see src/lib/sourcing.ts). A product found in the seller's niches
 * is "queued"; once checked with the same rules a real listing goes through,
 * it is "ready" (it will publish) or "rejected" with `reason` (a
 * RejectReason code) and `detail` (the seller-facing why).
 */
export const sourcingCandidates = pgTable(
  "sourcing_candidates",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pid: text("pid").notNull(),
    niche: text("niche").notNull().default(""),
    status: text("status").notNull().default("queued"), // 'queued' | 'ready' | 'rejected' | 'dismissed'
    reason: text("reason"),
    detail: text("detail"),
    title: text("title").notNull().default(""),
    imageUrl: text("image_url"),
    /** CJ's "listed by N sellers" when found. */
    listedNum: integer("listed_num").notNull().default(0),
    /** Winning Score when found: the order the queue is checked in. */
    score: real("score").notNull().default(0),
    cost: numeric("cost", { precision: 10, scale: 2 }),
    shipping: numeric("shipping", { precision: 10, scale: 2 }),
    listPrice: numeric("list_price", { precision: 10, scale: 2 }),
    profit: numeric("profit", { precision: 10, scale: 2 }),
    /** eBay market average the price was compared with, when found. */
    market: numeric("market", { precision: 10, scale: 2 }),
    variantCount: integer("variant_count").notNull().default(1),
    ebayCategory: text("ebay_category"),
    /** eBay demand when checked: units the top matching listings sold, and how many listings compete. */
    ebaySold: integer("ebay_sold"),
    ebayListings: integer("ebay_listings"),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.pid] })],
);

/** A seller's sourcing setup: which niches the checker searches, and its last run. */
export const sourcingSettings = pgTable("sourcing_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  niches: jsonb("niches").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CJ orders AutoPilot created for eBay orders (one per eBay order). Holds no
 * buyer details: the address goes straight from eBay to CJ.
 * status: created (awaiting payment in CJ) → paid → shipped (tracking on CJ)
 * → tracking_sent (on eBay, order marked shipped); error / cancelled.
 */
export const cjOrders = pgTable(
  "cj_orders",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ebayOrderId: text("ebay_order_id").notNull(),
    cjOrderId: text("cj_order_id"),
    /** The orderNumber sent to CJ (the eBay order id; test orders get a suffix). */
    cjOrderNumber: text("cj_order_number").notNull(),
    sandbox: boolean("sandbox").notNull().default(false),
    status: text("status").notNull().default("created"),
    /** CJ's own status: CREATED, UNPAID, UNSHIPPED, SHIPPED, DELIVERED, CANCELLED… */
    cjStatus: text("cj_status"),
    logisticName: text("logistic_name"),
    fromCountry: text("from_country"),
    amount: numeric("amount", { precision: 10, scale: 2 }),
    trackingNumber: text("tracking_number"),
    carrier: text("carrier"),
    ebayShippedAt: timestamp("ebay_shipped_at", { withTimezone: true }),
    error: text("error"),
    /** Created by automatic ordering (not by the seller pressing a button). */
    auto: boolean("auto").notNull().default(false),
    /** When AutoPilot paid it from the CJ wallet. */
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** What automatic ordering did, in plain words ("Paid $24.73 from your CJ wallet…"). */
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.ebayOrderId] })],
);

/** Automatic ordering on CJ for new eBay sales: off, create (and check) only, or create and pay from the CJ wallet. */
export const autoOrderSettings = pgTable("auto_order_settings", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mode: text("mode").notNull().default("off"), // 'off' | 'create' | 'pay'
  /** Most a single CJ order may cost to be paid automatically (USD). */
  maxOrder: real("max_order").notNull().default(40),
  /** Most paid automatically in any 24 hours (USD). */
  maxDay: real("max_day").notNull().default(150),
  /** When it was last switched on: only eBay orders after this are ordered. */
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  adRatePct: real("ad_rate_pct").notNull().default(4),
  /** The seller's real eBay fee per sale, %: 13.55 standard; more for sellers outside the US (international, currency fees). */
  ebayFeePct: real("ebay_fee_pct").notNull().default(13.55),
  /** What paying suppliers in USD costs the seller in currency conversion, %. */
  fxPct: real("fx_pct").notNull().default(0),
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
