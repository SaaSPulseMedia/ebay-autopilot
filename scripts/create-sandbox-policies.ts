/**
 * One-off: create the shipping, payment and return business policies that
 * publishListing needs, for a seller whose sandbox Seller Hub policy page 404s.
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
import { ebayAccounts, users } from "@/db/schema";
import { ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { isEbaySandbox } from "@/lib/ebay/oauth";

const DUPLICATE_POLICY_ERROR = 20400;

// ebayFetch returns only the body; record each response's HTTP status for logging.
let lastStatus: number | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  lastStatus = null;
  const res = await realFetch(...args);
  lastStatus = res.status;
  return res;
};

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

const POLICIES: { label: string; path: string; body: Record<string, unknown> }[] = [
  {
    label: "Fulfillment (shipping)",
    path: "/sell/account/v1/fulfillment_policy",
    body: {
      name: "Default shipping",
      marketplaceId: "EBAY_US",
      categoryTypes: CATEGORY_TYPES,
      handlingTime: { value: 1, unit: "DAY" },
      shippingOptions: [
        {
          optionType: "DOMESTIC",
          costType: "FLAT_RATE",
          shippingServices: [
            {
              sortOrder: 1,
              shippingCarrierCode: "USPS",
              shippingServiceCode: "USPSPriority",
              shippingCost: { value: "5.00", currency: "USD" },
              additionalShippingCost: { value: "0.00", currency: "USD" },
              freeShipping: false,
              buyerResponsibleForShipping: false,
            },
          ],
        },
      ],
    },
  },
  {
    label: "Payment",
    path: "/sell/account/v1/payment_policy",
    body: {
      name: "Default payment",
      marketplaceId: "EBAY_US",
      categoryTypes: CATEGORY_TYPES,
      paymentMethods: [{ paymentMethodType: "PAYPAL" }],
    },
  },
  {
    label: "Return",
    path: "/sell/account/v1/return_policy",
    body: {
      name: "Default returns",
      marketplaceId: "EBAY_US",
      categoryTypes: CATEGORY_TYPES,
      returnsAccepted: true,
      returnPeriod: { value: 30, unit: "DAY" },
      returnShippingCostPayer: "BUYER",
      refundMethod: "MONEY_BACK",
    },
  },
];

async function main() {
  const email = (process.argv[2] ?? "itsy@store.com").trim().toLowerCase();
  console.log(`eBay environment: ${isEbaySandbox() ? "SANDBOX" : "PRODUCTION"}`);

  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No user with email ${email}.`);

  const accounts = await db
    .select({ id: ebayAccounts.id, mode: ebayAccounts.mode, label: ebayAccounts.label })
    .from(ebayAccounts)
    .where(eq(ebayAccounts.userId, user.id));
  console.log(`User ${email} (id ${user.id}) eBay accounts:`, accounts);

  const token = await getAccessTokenForUser(user.id);
  if (!token) throw new Error("No usable eBay access token. Reconnect the store in Settings and try again.");

  // Policies can only be created once the seller is opted in to business policies.
  const optIn = await ebayFetch("/sell/account/v1/program/opt_in", token, {
    method: "POST",
    body: JSON.stringify({ programType: "SELLING_POLICY_MANAGEMENT" }),
  });
  console.log(`\nOpt in to business policies → HTTP ${lastStatus}`);
  console.log(JSON.stringify(optIn, null, 2));

  let failed = 0;
  for (const policy of POLICIES) {
    const result = await ebayFetch(policy.path, token, { method: "POST", body: JSON.stringify(policy.body) });
    console.log(`\n${policy.label} policy → HTTP ${lastStatus}`);
    console.log(JSON.stringify(result, null, 2));

    if (!result.errors?.length) {
      console.log(`✓ ${policy.label} policy created.`);
    } else if (result.errors.some((e) => e.errorId === DUPLICATE_POLICY_ERROR)) {
      console.log(`✓ ${policy.label} policy already exists (error ${DUPLICATE_POLICY_ERROR}); skipping.`);
    } else {
      failed++;
      console.error(`✗ ${policy.label} policy failed. eBay errors:`);
      console.error(JSON.stringify(result.errors, null, 2));
    }
  }

  console.log(failed ? `\n${failed} policy call(s) failed.` : "\nAll three policies are in place.");
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end().catch(() => {}));
