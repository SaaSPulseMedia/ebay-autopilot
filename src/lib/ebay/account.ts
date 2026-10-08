import "server-only";

import { ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";

export type BusinessPolicies = {
  fulfillmentPolicyId: string | null;
  paymentPolicyId: string | null;
  returnPolicyId: string | null;
};

type FulfillmentPolicies = { fulfillmentPolicies?: { fulfillmentPolicyId?: string }[] };
type PaymentPolicies = { paymentPolicies?: { paymentPolicyId?: string }[] };
type ReturnPolicies = { returnPolicies?: { returnPolicyId?: string }[] };
type Locations = { locations?: { merchantLocationKey?: string }[] };

const MARKETPLACE = "marketplace_id=EBAY_US";

/** The seller's first shipping, payment and return policy on EBAY_US (null where none exist). */
export async function fetchBusinessPolicies(userId: number): Promise<BusinessPolicies> {
  const empty: BusinessPolicies = { fulfillmentPolicyId: null, paymentPolicyId: null, returnPolicyId: null };
  const token = await getAccessTokenForUser(userId);
  if (!token) return empty;

  const [fulfillment, payment, returns] = await Promise.all([
    ebayFetch<FulfillmentPolicies>(`/sell/account/v1/fulfillment_policy?${MARKETPLACE}`, token),
    ebayFetch<PaymentPolicies>(`/sell/account/v1/payment_policy?${MARKETPLACE}`, token),
    ebayFetch<ReturnPolicies>(`/sell/account/v1/return_policy?${MARKETPLACE}`, token),
  ]);

  return {
    fulfillmentPolicyId: fulfillment.fulfillmentPolicies?.[0]?.fulfillmentPolicyId ?? null,
    paymentPolicyId: payment.paymentPolicies?.[0]?.paymentPolicyId ?? null,
    returnPolicyId: returns.returnPolicies?.[0]?.returnPolicyId ?? null,
  };
}

/**
 * Offers need a merchant location. Reuses the seller's first one, or creates a
 * default US warehouse. Returns its key, or null when eBay refuses.
 */
export async function ensureMerchantLocation(userId: number): Promise<string | null> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return null;

  const existing = await ebayFetch<Locations>("/sell/inventory/v1/location?limit=1", token);
  if (existing.errors?.length) {
    console.warn(`[ebay] listing locations failed for user ${userId}: ${ebayErrorMessage(existing, "unknown error")}`);
    return null;
  }
  const found = existing.locations?.[0]?.merchantLocationKey;
  if (found) return found;

  const key = `autopilot-default-${String(userId).slice(0, 8)}`;
  const created = await ebayFetch(`/sell/inventory/v1/location/${encodeURIComponent(key)}`, token, {
    method: "POST",
    body: JSON.stringify({
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
    }),
  });
  if (created.errors?.length) {
    console.warn(`[ebay] creating location failed for user ${userId}: ${ebayErrorMessage(created, "unknown error")}`);
    return null;
  }
  return key;
}
