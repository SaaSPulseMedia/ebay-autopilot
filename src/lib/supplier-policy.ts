/**
 * Supplier-link policy.
 *
 * eBay allows dropshipping from a wholesale supplier, but NOT listing an item and
 * then buying it from another retailer or marketplace that ships to your buyer
 * ("retail arbitrage"). Accounts can be restricted or suspended for it:
 * https://www.ebay.com/help/policies/selling-policies/drop-shipping-policy?id=4176
 *
 * Pure module (no server imports) so the import screen can warn before submitting.
 */

export type SupplierCheck =
  | { allowed: true; warning: string | null; host: string }
  | { allowed: false; reason: string; host: string };

/** Retailers and retail marketplaces — filling eBay orders from these breaks eBay policy. */
const RETAIL_DOMAINS = [
  "amazon.com", "amazon.co.uk", "amazon.ca", "amzn.to", "amzn.com", "a.co",
  "walmart.com", "target.com", "homedepot.com", "lowes.com", "bestbuy.com", "costco.com", "samsclub.com",
  "kohls.com", "macys.com", "wayfair.com", "overstock.com", "newegg.com", "chewy.com", "ulta.com", "sephora.com",
  "ebay.com", "ebay.co.uk", "ebay.ca", "etsy.com", "temu.com", "shein.com", "poshmark.com", "mercari.com",
];

/** Marketplaces that are only acceptable through their official dropshipping programs. */
const MARKETPLACE_DOMAINS = ["aliexpress.com", "aliexpress.us", "alibaba.com", "dhgate.com"];

function matches(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

export function checkSupplierUrl(raw: string): SupplierCheck {
  let host = "";
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("bad protocol");
    host = url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return { allowed: false, reason: "This is not a valid web link.", host: raw.trim() };
  }

  const retail = RETAIL_DOMAINS.find((domain) => matches(host, domain));
  if (retail) {
    return {
      allowed: false,
      host,
      reason: `${retail} is a retail store. eBay does not allow filling orders by buying from another retailer or marketplace, so this link was skipped to protect your account. Use a wholesale or dropship supplier instead.`,
    };
  }

  const marketplace = MARKETPLACE_DOMAINS.find((domain) => matches(host, domain));
  return {
    allowed: true,
    host,
    warning: marketplace
      ? `${marketplace} is a marketplace. Only order through its official dropshipping program, not as a normal shopper.`
      : null,
  };
}
