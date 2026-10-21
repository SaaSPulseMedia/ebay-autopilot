/**
 * Product niches for the Winning page's "✨ Auto-Suggest Winners". Each niche
 * carries 5 generic, unbranded CJ search keywords used when Claude can't
 * suggest any, and `cj`: which of CJ's own categories it covers. `cj` is
 * matched (case-insensitive) against each CJ category's name and the names
 * above it (see cjCategoryScope in src/lib/cj/catalog.ts), which gives the
 * niche's CJ categoryIds at run time, since CJ's IDs aren't fixed numbers we
 * can hard-code. Products outside those categories are never suggested.
 */
export const NICHES = [
  { name: "Home & Garden", cj: /garden|furniture|home ?decor|household|home textile|home storage|storage & organi|lighting|lamps?\b/i, fallback: ["led cloud light", "electric spin scrubber", "sunset lamp", "solar garden lights", "vacuum storage bags"] },
  { name: "Kitchen & Dining", cj: /kitchen|dining|cookware|bakeware|drinkware|tableware|barware/i, fallback: ["silicone stretch lids", "vegetable chopper", "magnetic knife strip", "oil sprayer bottle", "reusable food storage bags"] },
  { name: "Pet Supplies", cj: /\bpets?\b/i, fallback: ["self cleaning cat brush", "dog slow feeder bowl", "pet hair remover roller", "cat window perch", "dog paw cleaner cup"] },
  { name: "Beauty & Personal Care", cj: /beauty|\bhair\b|makeup|skin ?care|\bnails?\b|personal care|cosmetic|bath & body/i, fallback: ["ice roller face", "scalp massager shampoo brush", "heatless hair curler", "makeup brush cleaner", "electric callus remover"] },
  { name: "Health & Fitness", cj: /health|fitness|massag|yoga|exercise|body ?building|medical/i, fallback: ["resistance bands set", "posture corrector", "massage gun mini", "ab roller wheel", "yoga mat strap"] },
  { name: "Phone Accessories", cj: /\bphones?\b|mobile|cellphone/i, fallback: ["magnetic car phone mount", "phone ring holder", "wireless charger stand", "phone tripod selfie stick", "waterproof phone pouch"] },
  { name: "Car Accessories", cj: /\bcars?\b|automobile|automotive|motorcycle|vehicle/i, fallback: ["car seat gap filler", "car trash can", "car vacuum cleaner portable", "headrest hook organizer", "car sun shade windshield"] },
  { name: "Computer & Office", cj: /computer|office|laptop|stationery|school supplies/i, fallback: ["laptop stand adjustable", "desk cable organizer", "monitor riser shelf", "ergonomic mouse pad", "usb c hub"] },
  { name: "Toys & Games", cj: /\btoys?\b|\bgames?\b|puzzle|hobb(y|ies)/i, fallback: ["fidget toy set", "magnetic building tiles", "bubble machine", "kids drawing tablet", "slime making kit"] },
  { name: "Baby & Kids", cj: /\bbab(y|ies)\b|\bkids?\b|mother|maternity|children|toddler/i, fallback: ["baby bath thermometer", "silicone baby bib", "toddler sippy cup", "baby nail trimmer electric", "kids night light"] },
  { name: "Sports & Outdoors", cj: /sports?\b|outdoor|camping|hiking|fishing|cycling/i, fallback: ["camping lantern rechargeable", "cooling towel", "collapsible water bottle", "jump rope weighted", "hammock straps"] },
  { name: "Tools & Home Improvement", cj: /home improvement|hardware|power tools|hand tools|tool sets?|electrical|plumbing|measur/i, fallback: ["magnetic wristband tool holder", "stud finder", "cordless screwdriver mini", "tape measure laser", "drill brush attachment"] },
  { name: "Jewelry & Watches", cj: /jewel|watch(es)?\b|earrings?|necklaces?|bracelets?|\brings?\b/i, fallback: ["stainless steel chain necklace", "hoop earrings set", "watch band silicone", "ring set stackable", "jewelry organizer box"] },
  { name: "Bags & Luggage", cj: /\bbags?\b|luggage|travel|backpacks?|wallets?|handbags?/i, fallback: ["packing cubes set", "crossbody phone bag", "luggage scale digital", "toiletry bag hanging", "waterproof dry bag"] },
] as const satisfies ReadonlyArray<{ name: string; cj: RegExp; fallback: readonly string[] }>;

export type NicheName = (typeof NICHES)[number]["name"];

export function findNiche(name: string) {
  return NICHES.find((n) => n.name === name) ?? null;
}
