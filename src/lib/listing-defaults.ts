/**
 * Listing defaults: the seller's own rules applied to every new listing.
 * Pure module (no server imports) so forms can validate with the same rules.
 */

export type ListingDefaults = {
  pricingMode: "suggested" | "markup";
  markupPct: number;
  adRatePct: number;
  quantityPerVariant: number;
  handlingDays: number;
  descriptionFooter: string;
};

export const DEFAULT_LISTING_DEFAULTS: ListingDefaults = {
  pricingMode: "suggested",
  markupPct: 40,
  adRatePct: 0,
  quantityPerVariant: 10,
  handlingDays: 2,
  descriptionFooter: "",
};

/** Handling times eBay offers in its listing form (0 = same business day). */
export const HANDLING_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15, 20, 30];

export const FOOTER_MAX = 1000;

function clamp(value: unknown, min: number, max: number, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Turns any input (form body, database row) into safe, in-range defaults. */
export function normalizeDefaults(input: Partial<Record<keyof ListingDefaults, unknown>>): ListingDefaults {
  const d = DEFAULT_LISTING_DEFAULTS;
  const handling = Math.round(clamp(input.handlingDays, 0, 30, d.handlingDays));
  return {
    pricingMode: input.pricingMode === "markup" ? "markup" : "suggested",
    markupPct: Math.round(clamp(input.markupPct, 0, 500, d.markupPct)),
    adRatePct: Math.round(clamp(input.adRatePct, 0, 30, d.adRatePct) * 10) / 10,
    quantityPerVariant: Math.round(clamp(input.quantityPerVariant, 1, 100, d.quantityPerVariant)),
    handlingDays: HANDLING_OPTIONS.includes(handling) ? handling : d.handlingDays,
    descriptionFooter:
      typeof input.descriptionFooter === "string"
        ? input.descriptionFooter.replace(/\r\n/g, "\n").trim().slice(0, FOOTER_MAX)
        : d.descriptionFooter,
  };
}

/** Listing description with the seller's footer appended (once). */
export function withFooter(description: string, footer: string) {
  const body = description.trim();
  const tail = footer.trim();
  if (!tail || body.endsWith(tail)) return body;
  return body ? `${body}\n\n${tail}` : tail;
}

export function handlingLabel(days: number) {
  return days === 0 ? "Same business day" : `${days} business day${days === 1 ? "" : "s"}`;
}
