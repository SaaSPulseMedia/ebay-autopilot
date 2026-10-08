/**
 * One-off: create the shipping, payment and return business policies that
 * publishListing needs (see src/lib/ebay/policies-setup.ts).
 *
 *   npm run create-sandbox-policies -- [email]   (default: itsy@store.com)
 *
 * Runs with --conditions=react-server so `server-only` resolves to its no-op
 * build outside Next.js.
 */
import "server-only";
import "dotenv/config";

import { eq } from "drizzle-orm";

import { db, pool } from "@/db";
import { users } from "@/db/schema";
import { isEbaySandbox } from "@/lib/ebay/oauth";
import { setupSandboxPolicies } from "@/lib/ebay/policies-setup";

async function main() {
  const email = (process.argv[2] ?? "itsy@store.com").trim().toLowerCase();
  console.log(`eBay environment: ${isEbaySandbox() ? "SANDBOX" : "PRODUCTION"}`);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No user with email ${email}.`);
  console.log(`User ${email} (id ${user.id})`);

  const result = await setupSandboxPolicies(user.id);
  console.log(JSON.stringify(result, null, 2));

  const failed = [result.fulfillment, result.payment, result.returns].filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} policy call(s) failed.` : "\nAll three policies are in place.");
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
