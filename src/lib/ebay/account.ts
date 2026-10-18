import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { type EbayErrorBody, ebayErrorMessage, ebayFetch, ebayRequest, getAccessTokenForUser } from "@/lib/ebay/client";

export type BusinessPolicies = {
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
};

export type PolicyOption = { id: string; name: string };
export type PolicyLists = { fulfillment: PolicyOption[]; payment: PolicyOption[]; returns: PolicyOption[] };
export type PolicyListResult = ({ ok: true } & PolicyLists) | { ok: false; error: string; notConnected?: true };

type FulfillmentPolicies = { fulfillmentPolicies?: { fulfillmentPolicyId?: string; name?: string }[] };
type PaymentPolicies = { paymentPolicies?: { paymentPolicyId?: string; name?: string }[] };
type ReturnPolicies = { returnPolicies?: { returnPolicyId?: string; name?: string }[] };
type Locations = { locations?: { merchantLocationKey?: string }[] };

const MARKETPLACE = "marketplace_id=EBAY_US";

function options<T extends { name?: string }>(items: T[] | undefined, idOf: (item: T) => string | undefined): PolicyOption[] {
  return (items ?? [])
    .map((item) => ({ id: idOf(item) ?? "", name: item.name?.trim() || "Untitled policy" }))
    .filter((option) => option.id);
}

/** Every shipping, payment and return policy the seller has on EBAY_US, with names. */
export async function listBusinessPolicies(userId: number): Promise<PolicyListResult> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return { ok: false, error: "No eBay store connected. Connect your store in Settings.", notConnected: true };

  const [fulfillment, payment, returns] = await Promise.all([
    ebayFetch<FulfillmentPolicies & EbayErrorBody>(`/sell/account/v1/fulfillment_policy?${MARKETPLACE}`, token),
    ebayFetch<PaymentPolicies & EbayErrorBody>(`/sell/account/v1/payment_policy?${MARKETPLACE}`, token),
    ebayFetch<ReturnPolicies & EbayErrorBody>(`/sell/account/v1/return_policy?${MARKETPLACE}`, token),
  ]);
  const failed = [fulfillment, payment, returns].find((body) => body.errors?.length);
  if (failed) return { ok: false, error: ebayErrorMessage(failed, "Could not load your business policies from eBay.") };

  return {
    ok: true,
    fulfillment: options(fulfillment.fulfillmentPolicies, (p) => p.fulfillmentPolicyId),
    payment: options(payment.paymentPolicies, (p) => p.paymentPolicyId),
    returns: options(returns.returnPolicies, (p) => p.returnPolicyId),
  };
}

/** The policies the seller saved in Settings (all null when none are saved or no store is connected). */
export async function getSavedPolicyIds(userId: number): Promise<BusinessPolicies> {
  const [row] = await db
    .select({
      fulfillmentPolicyId: ebayAccounts.fulfillmentPolicyId,
      paymentPolicyId: ebayAccounts.paymentPolicyId,
      returnPolicyId: ebayAccounts.returnPolicyId,
    })
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, userId), eq(ebayAccounts.mode, "oauth")))
    .limit(1);
  return row ?? { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null };
}

/** The saved policy when it still exists on eBay, otherwise the seller's first one. */
function pick(options: PolicyOption[], saved: string | null) {
  if (saved && options.some((o) => o.id === saved)) return saved;
  return options[0]?.id ?? null;
}

/**
 * The shipping, payment and return policy to put on offers. Uses the ones the
 * seller picked in Settings; for any not picked (or deleted on eBay since),
 * falls back to the seller's first policy of that kind. Null where none exist.
 */
export async function fetchBusinessPolicies(userId: number): Promise<BusinessPolicies> {
  const empty: BusinessPolicies = { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null };
  const [lists, saved] = await Promise.all([listBusinessPolicies(userId), getSavedPolicyIds(userId)]);
  if (!lists.ok) return empty;

  for (const [kind, list, id] of [
    ["fulfillment", lists.fulfillment, saved.fulfillmentPolicyId],
    ["payment", lists.payment, saved.paymentPolicyId],
    ["return", lists.returns, saved.returnPolicyId],
  ] as const) {
    if (id && !list.some((o) => o.id === id)) {
      console.warn(`[ebay-policies] user ${userId}: saved ${kind} policy ${id} no longer exists on eBay; using the first one`);
    }
  }

  return {
    fulfillmentPolicyId: pick(lists.fulfillment, saved.fulfillmentPolicyId),
    paymentPolicyId: pick(lists.payment, saved.paymentPolicyId),
    returnPolicyId: pick(lists.returns, saved.returnPolicyId),
  };
}

export type MerchantLocationResult = { ok: true; locationKey: string } | { ok: false; error: string; details?: unknown };

/** Default US warehouse used when the seller has no merchant location yet. */
export const DEFAULT_LOCATION_BODY = {
  name: "Default Warehouse",
  location: {
    address: {
      addressLine1: "Default Warehouse",
      city: "New York",
      stateOrProvince: "NY",
      postalCode: "10001",
      country: "US",
    },
  },
  locationTypes: ["WAREHOUSE"],
  merchantLocationStatus: "ENABLED",
};

/**
 * Offers need a merchant location. Reuses the seller's first one, or creates a
 * default US warehouse. On failure, returns eBay's raw error as `details`.
 */
export async function ensureMerchantLocation(userId: number): Promise<MerchantLocationResult> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return { ok: false, error: "No eBay store connected. Connect your store in Settings." };

  const existing = await ebayRequest<Locations>("/sell/inventory/v1/location?limit=1", token);
  if (existing.body.errors?.length) {
    const details = { status: existing.status, errors: existing.body.errors };
    console.error(`[ebay-location] listing locations failed for user ${userId}:`, JSON.stringify(details));
    return { ok: false, error: ebayErrorMessage(existing.body, "Could not list merchant locations on eBay."), details };
  }
  const found = existing.body.locations?.[0]?.merchantLocationKey;
  if (found) return { ok: true, locationKey: found };

  const key = `autopilot-default-${String(userId).slice(0, 8)}`;
  const created = await ebayRequest(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, token, {
    method: "POST",
    body: JSON.stringify(DEFAULT_LOCATION_BODY),
  });
  if (created.body.errors?.length) {
    const details = { status: created.status, errors: created.body.errors };
    console.error(`[ebay-location] creating location ${key} failed for user ${userId}:`, JSON.stringify(details));
    return { ok: false, error: ebayErrorMessage(created.body, "Could not create a merchant location on eBay."), details };
  }
  return { ok: true, locationKey: key };
}
