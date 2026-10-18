/**
 * Maps supplier shoe sizes ("EU 42", "42", "US 9", "9.5") to the standardized
 * size values an eBay footwear category accepts (e.g. its "US Shoe Size"
 * list). eBay rejects custom size values in these categories. Pure: no I/O.
 */

export type ShoeGender = "men" | "women" | "kids";

/**
 * EU → US conversions as most supplier size charts give them (CJ listings
 * included). Approximate by nature: brands differ by up to half a size.
 */
const EU_TO_US_MEN: Record<string, number> = {
  "38": 6, "38.5": 6, "39": 6.5, "40": 7, "40.5": 7.5, "41": 8, "42": 8.5, "42.5": 9, "43": 9.5,
  "44": 10, "44.5": 10.5, "45": 11, "45.5": 11.5, "46": 12, "47": 12.5, "47.5": 13, "48": 13.5, "48.5": 14,
};
const EU_TO_US_WOMEN: Record<string, number> = {
  "34": 4, "35": 5, "35.5": 5, "36": 6, "36.5": 6, "37": 6.5, "37.5": 6.5, "38": 7.5, "38.5": 7.5,
  "39": 8, "40": 9, "40.5": 9, "41": 9.5, "42": 10, "42.5": 10.5, "43": 11, "44": 12,
};

/** Who the category is for, from its path ("Clothing, Shoes & Accessories > Women > Women's Shoes > …"). */
export function genderFromCategoryPath(path: string): ShoeGender {
  const p = path.toLowerCase();
  if (/\b(kids?|boys?|girls?|baby|toddler|youth|children)\b/.test(p)) return "kids";
  if (/\bwomen'?s?\b/.test(p)) return "women";
  return "men";
}

/** True for categories whose path is about footwear. */
export function isFootwearPath(path: string) {
  return /\b(shoes?|footwear|boots?|sneakers?|sandals?|slippers?|heels?|loafers?|clogs?|flats?)\b/i.test(path);
}

type ParsedSize = { system: "US" | "EU" | "UK" | null; value: number };

/**
 * Reads a supplier size string. Returns null for anything that isn't one
 * clear shoe size: letter sizes ("M"), ranges ("39-40"), lengths ("25cm"), "One Size".
 */
export function parseShoeSize(raw: string): ParsedSize | null {
  const text = raw.trim().toUpperCase().replace(/,/g, ".");
  // One size, optionally marked EU/US/UK before or after, optionally an M/W suffix: "EU 42", "42EU", "US9", "9.5 W".
  const match = text.match(/^(EUR?|US|UK)?\s*(\d+(?:\.\d+)?)\s*(EUR?|US|UK)?\s*(?:M|W)?$/);
  if (!match || (match[1] && match[3])) return null;
  const value = Number(match[2]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const marker = match[1] ?? match[3];
  return { system: marker ? (marker.startsWith("EU") ? "EU" : (marker as "US" | "UK")) : null, value };
}

/** The supplier size as a US size number, or null when it can't be converted. */
export function toUsSize(raw: string, gender: ShoeGender): number | null {
  const parsed = parseShoeSize(raw);
  if (!parsed) return null;
  const { value } = parsed;
  // Without a marker, 30+ is EU (adult EU sizes start in the 30s); up to 16 is US.
  const system = parsed.system ?? (value >= 30 ? "EU" : value <= 16 ? "US" : null);
  if (system === "US") return value;
  if (system === "UK") return gender === "women" ? value + 2 : gender === "men" ? value + 1 : null;
  if (system === "EU") {
    if (gender === "kids") return null; // kids' EU→US charts vary too much to guess
    const table = gender === "women" ? EU_TO_US_WOMEN : EU_TO_US_MEN;
    return table[String(value)] ?? null;
  }
  return null;
}

/** "9" for 9, "9.5" for 9.5 — how eBay writes US shoe sizes. */
function formatUs(n: number) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * The eBay size value for a supplier size: the allowed value nearest the
 * converted US size (within half a size), or null when there is none.
 * With no allowed list (a free-text aspect) the US size itself is used.
 */
export function mapToEbayShoeSize(raw: string, allowed: string[], gender: ShoeGender): string | null {
  const us = toUsSize(raw, gender);
  if (us == null) return null;
  if (!allowed.length) return formatUs(us);

  let best: { value: string; distance: number } | null = null;
  for (const value of allowed) {
    // Only plain numeric values ("9", "9.5", "US 9"); width or kids' variants ("9 Wide", "9C") are skipped.
    const match = value.trim().match(/^(?:US\s*)?(\d+(?:\.\d+)?)$/i);
    if (!match) continue;
    const distance = Math.abs(Number(match[1]) - us);
    if (distance <= 0.5 && (!best || distance < best.distance)) best = { value, distance };
  }
  return best?.value ?? null;
}

type SizedVariant = { options: Record<string, string> };

export type ShoeSizePlan<T extends SizedVariant> = {
  /** Variants whose size mapped, with the size moved to the eBay aspect (e.g. "US Shoe Size": "8.5"). */
  variants: T[];
  /** Supplier sizes with no matching eBay value; those variants are left out. */
  skipped: string[];
};

/**
 * Rewrites each variant's supplier size to the category's standardized size
 * aspect. Variants without a size option pass through unchanged; variants
 * whose size has no valid eBay value are dropped and reported in `skipped`.
 */
export function standardizeShoeSizes<T extends SizedVariant>(
  variants: T[],
  aspect: { name: string; values: string[] },
  gender: ShoeGender,
): ShoeSizePlan<T> {
  const kept: T[] = [];
  const skipped = new Set<string>();
  for (const variant of variants) {
    const sizeKey = Object.keys(variant.options).find((key) => /size/i.test(key));
    if (!sizeKey) {
      kept.push(variant);
      continue;
    }
    const raw = variant.options[sizeKey];
    const mapped = mapToEbayShoeSize(raw, aspect.values, gender);
    if (!mapped) {
      skipped.add(raw);
      continue;
    }
    const options = { ...variant.options };
    delete options[sizeKey];
    options[aspect.name] = mapped;
    kept.push({ ...variant, options });
  }
  return { variants: kept, skipped: [...skipped] };
}
