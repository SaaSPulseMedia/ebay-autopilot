/**
 * VeRO (eBay Verified Rights Owner) brand screening.
 *
 * Dropshipping branded goods is the fastest way to get listings pulled or an
 * account restricted. This is a keyword screen on the title (and category), not
 * legal advice and not a complete list of every rights owner — it catches the
 * brands sellers most often get takedowns for.
 *
 *  - "high"   → blocked. Brand name used as the product itself, or replica wording.
 *  - "medium" → allowed with a warning. Brand used only as compatibility
 *               ("case for iPhone 15"), which eBay permits when worded that way.
 *  - "low"    → no brand terms found.
 */

export type VeroRisk = "low" | "medium" | "high";

export type VeroResult = {
  risk: VeroRisk;
  /** Brand or phrase that triggered the result, for showing to the seller. */
  match: string | null;
  reason: string;
};

const BRANDS = [
  // Fashion & luxury
  "chanel", "dior", "christian dior", "gucci", "louis vuitton", "prada", "hermes", "versace", "burberry", "fendi",
  "balenciaga", "givenchy", "yves saint laurent", "ysl", "saint laurent", "dolce gabbana", "dolce & gabbana",
  "armani", "giorgio armani", "hugo boss", "calvin klein", "michael kors", "kate spade", "ralph lauren",
  "tommy hilfiger", "moncler", "canada goose", "the north face", "north face", "patagonia", "levi's", "levis",
  "lululemon", "ugg", "crocs", "dr martens", "dr. martens", "timberland", "coach bag", "coach purse", "coach wallet",
  "coach handbag",
  // Sportswear & footwear
  "nike", "air jordan", "adidas", "yeezy", "under armour", "puma", "reebok", "new balance", "converse",
  "vans shoes", "vans sneakers", "vans old skool", "skechers", "asics",
  // Watches & jewellery
  "rolex", "omega watch", "omega seamaster", "cartier", "tiffany & co", "tiffany and co", "pandora", "swarovski",
  "tag heuer", "casio", "g-shock",
  // Beauty & fragrance
  "lancome", "estee lauder", "mac cosmetics", "clinique", "maybelline", "l'oreal", "loreal", "essence mascara",
  "essence cosmetics", "revlon", "nyx", "fenty", "huda beauty", "urban decay", "too faced", "benefit cosmetics",
  "olaplex", "cerave",
  // Electronics ("apple" alone is skipped so "apple slicer" is not blocked)
  "iphone", "ipad", "airpods", "airtag", "macbook", "apple watch", "apple pencil", "samsung", "sony", "playstation",
  "xbox", "nintendo", "beats by dre", "beats headphones", "bose", "jbl", "dyson", "gopro", "fitbit", "garmin", "oculus",
  // Home & drinkware
  "yeti", "stanley", "hydro flask", "owala", "kitchenaid", "le creuset", "vitamix", "ninja blender", "ninja air fryer",
  "ninja foodi", "instant pot", "keurig",
  // Toys, characters & licences
  "disney", "marvel", "star wars", "pokemon", "lego", "barbie", "hot wheels", "hello kitty", "sanrio", "harry potter",
  "nfl", "nba", "mlb", "nhl", "fifa",
  // Eyewear
  "ray-ban", "ray ban", "rayban", "oakley",
];

const REPLICA_TERMS = ["replica", "inspired by", "dupe", "knockoff", "knock-off", "counterfeit", "1:1", "mirror quality", "aaa quality"];

/** Words that mean the brand is only named for compatibility, which eBay allows. */
const COMPATIBILITY_PREFIX = /\b(for|fits|compatible with|works with|replacement for)\s+$/;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`]/g, "'")
    .toLowerCase();
}

function escape(term: string) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function screenVero(title: string, category = ""): VeroResult {
  const text = normalize(`${title} ${category}`);

  for (const term of REPLICA_TERMS) {
    if (new RegExp(`(^|[^a-z0-9])${escape(term)}([^a-z0-9]|$)`).test(text)) {
      return { risk: "high", match: term, reason: `"${term}" wording is treated as counterfeit by eBay.` };
    }
  }

  let compatibilityMatch: string | null = null;
  for (const brand of BRANDS) {
    const re = new RegExp(`(^|[^a-z0-9])${escape(brand)}(?=[^a-z0-9]|$)`, "g");
    let found: RegExpExecArray | null;
    while ((found = re.exec(text))) {
      const before = text.slice(0, found.index + found[1].length);
      if (COMPATIBILITY_PREFIX.test(before)) {
        compatibilityMatch ??= brand;
        continue;
      }
      return {
        risk: "high",
        match: brand,
        reason: `"${brand}" is a brand that actively removes unauthorized eBay listings.`,
      };
    }
  }

  if (compatibilityMatch) {
    return {
      risk: "medium",
      match: compatibilityMatch,
      reason: `Mentions "${compatibilityMatch}" for compatibility only. Allowed, but keep the brand out of the main product name.`,
    };
  }

  return { risk: "low", match: null, reason: "No brand terms found." };
}

/** Combine a stored risk with the live screen, keeping whichever is stricter. */
export function stricterRisk(a: VeroRisk, b: VeroRisk): VeroRisk {
  const rank: Record<VeroRisk, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}
