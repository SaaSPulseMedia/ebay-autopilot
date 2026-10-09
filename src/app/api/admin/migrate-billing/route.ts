import { sql } from "drizzle-orm";

import { db } from "@/db";
import { hasAdminToken } from "@/lib/admin-token";

/**
 * Admin one-off: creates the billing tables in the production database.
 * Idempotent (CREATE … IF NOT EXISTS) — safe to run any number of times.
 * Mirrors `subscriptions` and `stripe_events` in src/db/schema.ts.
 * Needs the `x-admin-token: <CRON_SECRET>` header.
 */
export const dynamic = "force-dynamic";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id serial PRIMARY KEY,
    user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stripe_customer_id text NOT NULL,
    stripe_subscription_id text UNIQUE,
    plan text NOT NULL,
    status text NOT NULL,
    current_period_end timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_events (
    id text PRIMARY KEY,
    type text NOT NULL,
    processed_at timestamp with time zone NOT NULL DEFAULT now()
  )`,
];

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  try {
    for (const statement of STATEMENTS) await db.execute(sql.raw(statement));
    console.log("[billing] migrate-billing: tables ensured");
    return Response.json({ ok: true, tables: ["subscriptions", "stripe_events"] });
  } catch (error) {
    console.error("[billing] migrate-billing failed:", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Migration failed." }, { status: 500 });
  }
}
