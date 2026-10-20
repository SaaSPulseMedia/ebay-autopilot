import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { ebayAccounts } from "@/db/schema";
import { type EbayError, ebayErrorMessage, ebayFetch, getAccessTokenForUser } from "@/lib/ebay/client";
import { MARKETING_SCOPE, grantedScopes } from "@/lib/ebay/oauth";

/**
 * Promoted Listings (General, cost per sale) for published listings. eBay
 * offers have no ad-rate field: a listing is promoted by adding it as an ad
 * to a cost-per-sale campaign through the Marketing API, with its own ad rate
 * (`bidPercentage`). AutoPilot keeps one campaign per store, created on first
 * use. Needs the sell.marketing scope, which stores connected before it was
 * asked for don't have until the seller reconnects.
 */

const CAMPAIGN_NAME = "AutoPilot Promoted Listings";
const MARKETING = "/sell/marketing/v1";

export type PromotionResult =
  | { applied: true; ratePct: number; campaignId: string }
  | { applied: false; ratePct: number; reason: string };

/** eBay's rate format: a decimal string with one place, e.g. "4.0". */
export const bidPercentage = (ratePct: number) => ratePct.toFixed(1);

type Campaign = { campaignId?: string; campaignStatus?: string; campaignName?: string };

async function account(userId: number) {
  const [row] = await db
    .select({ id: ebayAccounts.id, scopes: ebayAccounts.scopes, promoCampaignId: ebayAccounts.promoCampaignId })
    .from(ebayAccounts)
    .where(and(eq(ebayAccounts.userId, userId), eq(ebayAccounts.mode, "oauth")))
    .limit(1);
  return row ?? null;
}

/** AutoPilot's running campaign on the store: the saved one, one found by name, or a new one. */
async function ensureCampaign(
  token: string,
  accountId: number,
  savedId: string | null,
  ratePct: number,
): Promise<{ ok: true; campaignId: string } | { ok: false; error: string }> {
  const usable = async (campaign: Campaign | null | undefined) => {
    if (!campaign?.campaignId || campaign.campaignStatus === "ENDED") return null;
    if (campaign.campaignStatus === "PAUSED") {
      await ebayFetch(`${MARKETING}/ad_campaign/${encodeURIComponent(campaign.campaignId)}/resume`, token, { method: "POST" });
    }
    return campaign.campaignId;
  };

  let campaignId = savedId
    ? await usable(await ebayFetch<Campaign>(`${MARKETING}/ad_campaign/${encodeURIComponent(savedId)}`, token))
    : null;
  if (!campaignId) {
    const byName = await ebayFetch<Campaign>(
      `${MARKETING}/ad_campaign/get_campaign_by_name?campaign_name=${encodeURIComponent(CAMPAIGN_NAME)}`,
      token,
    );
    campaignId = await usable(byName.errors?.length ? null : byName);
  }
  if (!campaignId) {
    // eBay answers 201 with the new campaign in a Location header, so look it up by name afterwards.
    const created = await ebayFetch(`${MARKETING}/ad_campaign`, token, {
      method: "POST",
      body: JSON.stringify({
        campaignName: CAMPAIGN_NAME,
        marketplaceId: "EBAY_US",
        startDate: new Date().toISOString(),
        fundingStrategy: { fundingModel: "COST_PER_SALE", bidPercentage: bidPercentage(ratePct) },
      }),
    });
    if (created.errors?.length) {
      return { ok: false, error: ebayErrorMessage(created, "eBay would not create a Promoted Listings campaign.") };
    }
    const found = await ebayFetch<Campaign>(
      `${MARKETING}/ad_campaign/get_campaign_by_name?campaign_name=${encodeURIComponent(CAMPAIGN_NAME)}`,
      token,
    );
    campaignId = found.campaignId ?? null;
    if (!campaignId) return { ok: false, error: "eBay created the Promoted Listings campaign but didn't return it." };
    console.log(`[promoted] account ${accountId}: created campaign ${campaignId}`);
  }

  if (campaignId !== savedId) {
    await db.update(ebayAccounts).set({ promoCampaignId: campaignId }).where(eq(ebayAccounts.id, accountId));
  }
  return { ok: true, campaignId };
}

type AdResponses = { responses?: Array<{ listingId?: string; adId?: string; statusCode?: number; errors?: EbayError[] }> };

const alreadyAdded = (errors: EbayError[] = []) =>
  errors.some((e) => /already exists|already been added|duplicate/i.test(`${e.message ?? ""} ${e.longMessage ?? ""}`));

/**
 * Promotes one published listing (single or multi-variation: both are one
 * eBay listing ID) at `ratePct` %. A listing already in the campaign gets its
 * rate set to `ratePct`. Never throws; a failure is reported, not fatal: the
 * listing itself is already live.
 */
export async function promoteListing(userId: number, listingId: string, ratePct: number): Promise<PromotionResult> {
  if (!(ratePct > 0)) return { applied: false, ratePct, reason: "the ad rate in Settings is 0%" };
  try {
    const row = await account(userId);
    if (!row) return { applied: false, ratePct, reason: "no eBay store connected" };
    if (!grantedScopes(row.scopes).includes(MARKETING_SCOPE)) {
      return { applied: false, ratePct, reason: "reconnect your eBay store in Settings to allow Promoted Listings" };
    }
    const token = await getAccessTokenForUser(userId);
    if (!token) return { applied: false, ratePct, reason: "no eBay store connected" };

    const campaign = await ensureCampaign(token, row.id, row.promoCampaignId, ratePct);
    if (!campaign.ok) return { applied: false, ratePct, reason: campaign.error };
    const base = `${MARKETING}/ad_campaign/${encodeURIComponent(campaign.campaignId)}`;
    const request = { requests: [{ listingId, bidPercentage: bidPercentage(ratePct) }] };

    const added = await ebayFetch<AdResponses>(`${base}/bulk_create_ads_by_listing_id`, token, {
      method: "POST",
      body: JSON.stringify(request),
    });
    const result = added.responses?.[0];
    const errors = result?.errors ?? added.errors;
    if (errors?.length && alreadyAdded(errors)) {
      const updated = await ebayFetch<AdResponses>(`${base}/bulk_update_ads_bid_by_listing_id`, token, {
        method: "POST",
        body: JSON.stringify(request),
      });
      const updateErrors = updated.responses?.[0]?.errors ?? updated.errors;
      if (updateErrors?.length) {
        return { applied: false, ratePct, reason: ebayErrorMessage({ errors: updateErrors }, "eBay would not update the ad rate.") };
      }
    } else if (errors?.length) {
      console.warn(`[promoted] listing ${listingId}: adding the ad failed:`, JSON.stringify(errors));
      return { applied: false, ratePct, reason: ebayErrorMessage({ errors }, "eBay would not add the listing to Promoted Listings.") };
    }
    console.log(`[promoted] listing ${listingId}: promoted at ${bidPercentage(ratePct)}% in campaign ${campaign.campaignId}`);
    return { applied: true, ratePct, campaignId: campaign.campaignId };
  } catch (error) {
    return { applied: false, ratePct, reason: error instanceof Error ? error.message : "Promoted Listings call failed" };
  }
}

/** The line added to a publish message, e.g. "Promoted Listings: 4.0% ad rate applied." */
export function promotionMessage(promotion: PromotionResult | undefined) {
  if (!promotion) return "";
  return promotion.applied
    ? `Promoted Listings: ${bidPercentage(promotion.ratePct)}% ad rate applied.`
    : `Promoted Listings not applied (${promotion.reason}).`;
}
