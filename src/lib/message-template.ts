/**
 * The thank-you message template (shared by the server and the settings
 * form's preview): {first_name}, {item} and {order} are filled in per sale.
 */

export const DEFAULT_MESSAGE =
  "Hi {first_name}. Your {item} is on its way! The tracking details should be released shortly for your peace of mind. Thank you for shopping with us. We remain at your disposal should you have any questions. Bargain-Breeze";

/** What a listing title is, in one word ("Men's Hooded Down Jacket … Winter Coat" → "jacket"); first one named wins. */
const PRODUCT_WORDS = [
  "jacket", "coat", "blazer", "suit", "dress", "skirt", "sweater", "cardigan", "hoodie", "sweatshirt", "shirt", "blouse",
  "jeans", "trousers", "pants", "leggings", "shorts", "jumpsuit", "romper", "pajamas", "swimsuit", "bikini", "bra", "socks",
  "boots", "sneakers", "sandals", "slippers", "shoes", "heels", "hat", "cap", "scarf", "gloves", "bag", "handbag", "backpack",
  "wallet", "belt", "watch", "necklace", "bracelet", "earrings", "sunglasses", "mug", "cup", "bottle", "lamp",
  "projector", "headphones", "earbuds", "speaker", "charger", "cable", "toy", "doll", "puzzle", "rug", "pillow",
  "cushion", "blanket", "curtain", "towel", "headband", "motor",
];

/** Plurals that read better kept as they are ("shoes", "boots"). */
const KEEP_PLURAL = new Set(["jeans", "trousers", "pants", "leggings", "shorts", "pajamas", "socks", "boots", "sneakers", "sandals", "slippers", "shoes", "heels", "gloves", "earrings", "sunglasses", "headphones", "earbuds"]);

export function itemWord(title: string) {
  const words = title.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/);
  for (const w of words) {
    if (PRODUCT_WORDS.includes(w)) return w;
    const singular = w.endsWith("es") && PRODUCT_WORDS.includes(w.slice(0, -2)) ? w.slice(0, -2) : w.endsWith("s") && PRODUCT_WORDS.includes(w.slice(0, -1)) ? w.slice(0, -1) : null;
    if (singular) return KEEP_PLURAL.has(w) ? w : singular;
  }
  return "order";
}

export function renderMessage(template: string, values: { firstName: string; itemTitle: string; orderId: string }) {
  const name = values.firstName ? values.firstName.charAt(0).toUpperCase() + values.firstName.slice(1).toLowerCase() : "there";
  const item = itemWord(values.itemTitle);
  let text = template;
  // "Your boots is on its way" → "Your boots are on their way".
  if (KEEP_PLURAL.has(item)) text = text.replace(/\{item\}(\s+)is on its way/gi, "{item}$1are on their way");
  return text
    .replace(/\{first_name\}/gi, name)
    .replace(/\{item\}/gi, item)
    .replace(/\{order\}/gi, values.orderId)
    .trim();
}
