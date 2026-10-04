export type Variant = {
  sku: string;
  options: Record<string, string>;
  price: number;
  quantity: number;
};

const APPAREL = ["clothing", "shirt", "tee", "hoodie", "jacket", "shoe", "sneaker", "dress", "apparel", "sock", "hat"];
const COLOR_GOODS = ["mat", "cushion", "curtain", "tumbler", "case", "cover", "band", "mount", "organizer", "light"];

const SIZES = ["S", "M", "L", "XL", "2XL"];
const COLORS = ["Black", "White", "Navy", "Gray", "Red"];

function slug(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
}

/**
 * Expands a supplier product into eBay multi-variant rows.
 * Deterministic so the same product always produces the same SKUs.
 */
export function buildVariants(title: string, category: string, basePrice: number, maxVariants = 20): Variant[] {
  const haystack = `${title} ${category}`.toLowerCase();
  // Whole-word matching only: substring matching turned "steel" into "tee"
  // and gave a stainless tumbler clothing sizes.
  const hasWord = (word: string) => new RegExp(`\\b${word}s?\\b`).test(haystack);
  const isApparel = APPAREL.some(hasWord);
  const hasColors = isApparel || COLOR_GOODS.some(hasWord);

  const base = slug(title);
  const rows: Variant[] = [];

  if (isApparel) {
    for (const size of SIZES) {
      for (const color of COLORS.slice(0, 3)) {
        rows.push({
          sku: `${base}-${size}-${slug(color)}`,
          options: { Size: size, Color: color },
          price: Math.round((basePrice + (size === "2XL" ? 2 : size === "XL" ? 1 : 0)) * 100) / 100,
          quantity: 10,
        });
      }
    }
  } else if (hasColors) {
    for (const color of COLORS.slice(0, 4)) {
      rows.push({
        sku: `${base}-${slug(color)}`,
        options: { Color: color },
        price: Math.round(basePrice * 100) / 100,
        quantity: 15,
      });
    }
  } else {
    rows.push({
      sku: base || "DEFAULT",
      options: { Style: "Standard" },
      price: Math.round(basePrice * 100) / 100,
      quantity: 20,
    });
  }

  return rows.slice(0, Math.max(1, maxVariants));
}
