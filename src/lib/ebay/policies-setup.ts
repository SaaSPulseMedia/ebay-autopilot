import "server-only";

import { type EbayError, ebayErrorMessage, ebayRequest, getAccessTokenForUser } from "@/lib/ebay/client";

/**
 * Creates the shipping, payment and return business policies publishListing
 * needs. Sandbox Seller Hub's policy page 404s, so this goes through the
 * Account API instead. Safe to re-run: an existing policy counts as success.
 */

/** eBay's error when a policy with the same name already exists. */
const DUPLICATE_POLICY_ERROR = 20400;
/** eBay's error code that also carries some "duplicate name" rejections. */
const POLICY_INPUT_ERROR = 20403;

/** eBay reports a duplicate policy name several ways; any of them means it already exists. */
function isAlreadyExists(error: EbayError) {
  const text = `${error.longMessage ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    error.errorId === DUPLICATE_POLICY_ERROR ||
    (error.errorId === POLICY_INPUT_ERROR && text.includes("duplicate")) ||
    text.includes("business profile name is a duplicate") ||
    text.includes("already exists")
  );
}

export type PolicyCallResult = { status: number; ok: boolean; alreadyExists?: boolean; error?: string };

export type PolicySetupResult = {
  fulfillment: PolicyCallResult;
  payment: PolicyCallResult;
  returns: PolicyCallResult;
  optIn: { attempted: boolean; status?: number; alreadyOptedIn?: boolean; error?: string };
};

const CATEGORY_TYPES = [{ name: "ALL_EXCLUDING_MOTORS_VEHICLES" }];

const POLICIES = {
  fulfillment: {
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
  payment: {
    path: "/sell/account/v1/payment_policy",
    body: {
      name: "Default payment",
      marketplaceId: "EBAY_US",
      categoryTypes: CATEGORY_TYPES,
      // No paymentMethods: under Managed Payments eBay rejects them (20403) and fills them in itself.
    },
  },
  returns: {
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
} as const;

async function createPolicy(token: string, policy: (typeof POLICIES)[keyof typeof POLICIES]) {
  const { status, body } = await ebayRequest(policy.path, token, { method: "POST", body: JSON.stringify(policy.body) });
  if (!body.errors?.length) return { status, ok: true } satisfies PolicyCallResult;
  if (body.errors.some(isAlreadyExists)) {
    return { status, ok: true, alreadyExists: true } satisfies PolicyCallResult;
  }
  return { status, ok: false, error: JSON.stringify(body.errors) } satisfies PolicyCallResult;
}

export async function setupSandboxPolicies(userId: number): Promise<PolicySetupResult> {
  const token = await getAccessTokenForUser(userId);
  if (!token) {
    const noToken = { status: 0, ok: false, error: "No usable eBay access token. Reconnect the store in Settings." };
    return { fulfillment: noToken, payment: noToken, returns: noToken, optIn: { attempted: false } };
  }

  // Policies can only be created once the seller is opted in to business policies.
  // 409 means already opted in. Any other error is reported but does not stop the run.
  const optIn = await ebayRequest("/sell/account/v1/program/opt_in", token, {
    method: "POST",
    body: JSON.stringify({ programType: "SELLING_POLICY_MANAGEMENT" }),
  });
  const alreadyOptedIn = optIn.status === 409;

  return {
    optIn: {
      attempted: true,
      status: optIn.status,
      ...(alreadyOptedIn ? { alreadyOptedIn: true } : {}),
      ...(!alreadyOptedIn && optIn.body.errors?.length
        ? { error: ebayErrorMessage(optIn.body, "Opt-in failed.") }
        : {}),
    },
    fulfillment: await createPolicy(token, POLICIES.fulfillment),
    payment: await createPolicy(token, POLICIES.payment),
    returns: await createPolicy(token, POLICIES.returns),
  };
}
