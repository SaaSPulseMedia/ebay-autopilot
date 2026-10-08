import "server-only";

import { ebayErrorMessage, ebayFetch, ebayRequest, getAccessTokenForUser } from "@/lib/ebay/client";

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
