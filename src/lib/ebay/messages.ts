import "server-only";

import { isEbaySandbox } from "@/lib/ebay/oauth";

/**
 * Sends a message to the buyer of an order through eBay's own messaging
 * (Trading API AddMemberMessageAAQToPartner: a message between the two
 * parties of a transaction, shown in the buyer's eBay Messages). Works with
 * the seller's OAuth token. eBay allows it for 90 days after the sale and
 * rejects messages with links or contact details outside eBay.
 */

const COMPATIBILITY_LEVEL = "1271";
/** eBay's limits for a member message. */
const MAX_BODY = 2000;
const MAX_SUBJECT = 80;

const xml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const tag = (body: string, name: string) => body.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? "";

export async function sendBuyerMessage(
  accessToken: string,
  message: { itemId: string; buyerUsername: string; subject: string; body: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const request = `<?xml version="1.0" encoding="utf-8"?>
<AddMemberMessageAAQToPartnerRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <ItemID>${message.itemId.replace(/\D/g, "")}</ItemID>
  <MemberMessage>
    <Subject>${xml(message.subject.slice(0, MAX_SUBJECT))}</Subject>
    <Body>${xml(message.body.slice(0, MAX_BODY))}</Body>
    <QuestionType>General</QuestionType>
    <RecipientID>${xml(message.buyerUsername)}</RecipientID>
  </MemberMessage>
</AddMemberMessageAAQToPartnerRequest>`;
  try {
    const res = await fetch(`${isEbaySandbox() ? "https://api.sandbox.ebay.com" : "https://api.ebay.com"}/ws/api.dll`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "AddMemberMessageAAQToPartner",
        "X-EBAY-API-SITEID": "0",
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPATIBILITY_LEVEL,
        "X-EBAY-API-IAF-TOKEN": accessToken,
      },
      body: request,
      cache: "no-store",
    });
    const reply = await res.text();
    const ack = tag(reply, "Ack");
    if (ack === "Success" || ack === "Warning") return { ok: true };
    return { ok: false, error: tag(reply, "LongMessage") || tag(reply, "ShortMessage") || `eBay returned HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach eBay." };
  }
}
