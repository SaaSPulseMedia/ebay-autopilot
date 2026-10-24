/**
 * Maps supplier sizes to the standardized size values an eBay category
 * accepts: shoe sizes ("EU 42", "42", "US 9") to footwear lists such as "US
 * Shoe Size", and apparel sizes ("M", "XXL", "Free Size") to apparel "Size"
 * lists. eBay rejects custom size values in these categories. Pure: no I/O.
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

/**
 * Kids' shoes sized by foot length ("13cm"): [cm, US kids' size] points of a
 * common infant/toddler/youth chart, read between points (approximate).
 */
const KIDS_FOOT_CM_TO_US: Array<[number, number]> = [
  [9, 1], [10, 2], [10.5, 3], [11.5, 4], [12, 5], [13, 6], [13.5, 7], [14.5, 8], [15.5, 9],
  [16, 10], [16.5, 10.5], [17, 11], [18, 12], [18.5, 13], [19.5, 1.5], [20.5, 2.5], [21.5, 3.5],
];

/** A kids' foot length ("13cm", "13.5 CM") as a US kids' size, to the half size; null outside the chart. */
function kidsFootCmToUs(raw: string): number | null {
  const match = raw.trim().match(/^(\d{1,2}(?:\.\d)?)\s*cm$/i);
  if (!match) return null;
  const cm = Number(match[1]);
  // Past 18.5 cm the chart restarts at youth sizes (1.5Y, 2.5Y…): read those segments on their own.
  for (let i = 0; i < KIDS_FOOT_CM_TO_US.length - 1; i++) {
    const [c0, u0] = KIDS_FOOT_CM_TO_US[i];
    const [c1, u1] = KIDS_FOOT_CM_TO_US[i + 1];
    if (cm < c0 || cm > c1 || u1 < u0) continue;
    return Math.round((u0 + ((cm - c0) / (c1 - c0)) * (u1 - u0)) * 2) / 2;
  }
  const exact = KIDS_FOOT_CM_TO_US.find(([c]) => c === cm);
  return exact ? exact[1] : null;
}

/** The supplier size as a US size number, or null when it can't be converted. */
export function toUsSize(raw: string, gender: ShoeGender): number | null {
  if (gender === "kids") {
    const fromCm = kidsFootCmToUs(raw);
    if (fromCm != null) return fromCm;
  }
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

/**
 * Slippers and sandals are often sized as a range of two adjacent sizes
 * ("36-37", "EU 38/39"): such a range is listed at its lower size. Wider or
 * odd ranges return null.
 */
function lowerOfRange(raw: string): string | null {
  const match = raw.trim().match(/^(\D*?)\s*(\d+(?:\.\d+)?)\s*[-/~]\s*(\d+(?:\.\d+)?)\s*(\D*)$/);
  if (!match) return null;
  const [, prefix, lo, hi, suffix] = match;
  const gap = Number(hi) - Number(lo);
  return gap > 0 && gap <= 1 ? `${prefix}${lo}${suffix}`.trim() : null;
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
  const us = toUsSize(lowerOfRange(raw) ?? raw, gender);
  if (us == null) return null;
  if (!allowed.length) return formatUs(us);

  let best: { value: string; distance: number } | null = null;
  for (const value of allowed) {
    // Adults: only plain numeric values ("9", "9.5", "US 9"); width or kids' variants ("9 Wide", "9C") are skipped.
    // Kids: those kids' spellings are the right ones ("6C", "6 Toddler", "6 M US Toddler").
    const match =
      gender === "kids"
        ? value.trim().match(/^(?:US\s*)?(\d+(?:\.\d+)?)\s*(?:C|K|T|M|US|Toddler|Infant|Baby|Little Kid|Big Kid|Youth|\s)*$/i)
        : value.trim().match(/^(?:US\s*)?(\d+(?:\.\d+)?)$/i);
    if (!match) continue;
    const distance = Math.abs(Number(match[1]) - us);
    if (distance <= 0.5 && (!best || distance < best.distance)) best = { value, distance };
  }
  return best?.value ?? null;
}

/** A category's standardized size aspect. "shoe" sizes convert EU/UK → US; "apparel" sizes match by name. */
export type SizeAspectKind = "shoe" | "apparel";

const ONE_SIZE = /^(ONESIZE|ONESIZEFITSALL|ONESIZEFITSMOST|OSFA|OSFM|OS|FREESIZE|FREE|UNIVERSAL|ADJUSTABLE)$/;

/**
 * One spelling per apparel size, so supplier and eBay values compare equal:
 * "Small"/"s" → "S", "XXL"/"2X-Large" → "2XL", "Free Size"/"One Size" → "ONESIZE".
 */
export function canonicalApparelSize(raw: string) {
  let v = raw.trim().toUpperCase().replace(/[\s_.-]+/g, "");
  v = v.replace(/^EXTRA/, "X").replace(/XLARGE$/, "XL").replace(/XSMALL$/, "XS");
  const words: Record<string, string> = { SMALL: "S", MEDIUM: "M", LARGE: "L", XLARGE: "XL" };
  if (words[v]) v = words[v];
  // XXL / XXXL / XXS → 2XL / 3XL / 2XS (eBay uses both spellings across categories).
  const xs = v.match(/^(X{2,6})(L|S)$/);
  if (xs) v = `${xs[1].length}X${xs[2]}`;
  return ONE_SIZE.test(v) ? "ONESIZE" : v;
}

/**
 * The eBay value for one supplier size, or null when the category's list has
 * no match: exact (case-insensitive) first, then the same size spelled
 * differently, then — for shoe sizes — the EU/UK → US conversion, or — for
 * clothing — a child's height in cm to the US kids' size ("110cm" → "4T").
 * An empty allowed list (free-text aspect) only happens for shoes here, where
 * the converted US size is used.
 */
export function mapSizeValue(
  raw: string,
  aspect: { kind: SizeAspectKind; values: string[] },
  gender: ShoeGender,
): string | null {
  const value = raw.trim();
  if (!value) return null;
  const exact = aspect.values.find((v) => v.trim().toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const canonical = canonicalApparelSize(value);
  const alias = aspect.values.find((v) => canonicalApparelSize(v) === canonical);
  if (alias) return alias;
  if (aspect.kind === "shoe") return mapToEbayShoeSize(value, aspect.values, gender);
  return mapKidsHeightSize(value, aspect.values, gender);
}

/**
 * Chinese suppliers size kids' clothes by the child's height ("110cm"). The
 * US kids' sizes eBay lists for each height, best first, as common supplier
 * size charts give them (approximate by nature).
 */
const KIDS_BY_HEIGHT: Array<[maxCm: number, labels: string[]]> = [
  [59, ["0-3 Months", "Newborn", "3 Months"]],
  [66, ["3-6 Months", "6 Months"]],
  [73, ["6-9 Months", "6-12 Months", "9 Months"]],
  [80, ["12-18 Months", "12 Months", "18 Months"]],
  [90, ["2T", "18-24 Months", "24 Months"]],
  [100, ["3T", "3"]],
  [110, ["4T", "4"]],
  [120, ["5T", "6", "5"]],
  [130, ["7", "6X", "6"]],
  [140, ["8", "8-9"]],
  [150, ["10", "10-12"]],
  [160, ["12", "14"]],
  [170, ["14", "16"]],
];

/** "110cm", "110 cm" (or a bare "110" for a kids' category): the child's height in cm, else null. */
function kidsHeightCm(raw: string, gender: ShoeGender): number | null {
  const match = raw.trim().match(/^(\d{2,3})\s*(cm)?$/i);
  if (!match || (!match[2] && gender !== "kids")) return null;
  const cm = Number(match[1]);
  return cm >= 45 && cm <= 175 ? cm : null;
}

/** The eBay kids' size for a height-sized supplier size ("110cm" → "4T"), from the category's list, else null. */
export function mapKidsHeightSize(raw: string, allowed: string[], gender: ShoeGender): string | null {
  const cm = kidsHeightCm(raw, gender);
  if (cm == null) return null;
  const labels = KIDS_BY_HEIGHT.find(([max]) => cm <= max)?.[1] ?? [];
  for (const label of labels) {
    const hit = allowed.find((v) => kidsSizeKey(v) === kidsSizeKey(label));
    if (hit) return hit;
  }
  return null;
}

/**
 * One spelling per kids' size, so eBay's many ways of writing it compare
 * equal: "4", "4Y", "4 Years", "Size 4", "4 (XS)" → "4"; "4T" → "4t";
 * "12-18 Months", "12-18M" → "12-18m".
 */
export function kidsSizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\b(size|us|kids?|girls?|boys?|baby|toddler|infant|little|big)\b/g, "")
    .replace(/\s*months?\b/g, "m")
    .replace(/(\d)\s*(years?|yrs?|y)\b/g, "$1")
    .replace(/[\s']+/g, "");
}

/** The value a single listing uses when the supplier gives no usable size: eBay's "One Size" if offered, else its first value. */
export function defaultSizeValue(values: string[]) {
  return values.find((v) => canonicalApparelSize(v) === "ONESIZE") ?? values[0] ?? null;
}

type SizedVariant = { options: Record<string, string> };

export type SizePlan<T extends SizedVariant> = {
  /** Variants whose size mapped, with the size moved to the eBay aspect (e.g. "US Shoe Size": "8.5"). */
  variants: T[];
  /** eBay size values the kept variants use, in order, no repeats. */
  mapped: string[];
  /** Supplier sizes with no matching eBay value; those variants are left out. */
  skipped: string[];
};

/**
 * Rewrites each variant's supplier size to the category's standardized size
 * aspect. Variants without a size option pass through unchanged; variants
 * whose size has no valid eBay value are dropped and reported in `skipped`.
 */
export function standardizeSizes<T extends SizedVariant>(
  variants: T[],
  aspect: { name: string; kind: SizeAspectKind; values: string[] },
  gender: ShoeGender,
): SizePlan<T> {
  const kept: T[] = [];
  const mapped = new Set<string>();
  const skipped = new Set<string>();
  for (const variant of variants) {
    const sizeKey = Object.keys(variant.options).find((key) => /size/i.test(key));
    if (!sizeKey) {
      kept.push(variant);
      continue;
    }
    const raw = variant.options[sizeKey];
    const value = mapSizeValue(raw, aspect, gender);
    if (!value) {
      skipped.add(raw);
      continue;
    }
    mapped.add(value);
    const options = { ...variant.options };
    delete options[sizeKey];
    options[aspect.name] = value;
    kept.push({ ...variant, options });
  }
  return { variants: kept, mapped: [...mapped], skipped: [...skipped] };
}
