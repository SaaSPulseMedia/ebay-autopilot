/**
 * Size charts for clothing and shoes. CJ puts the size chart (and other
 * measurement shots) as images inside its product description; those are
 * kept at import (ProductFacts.descriptionImages). For apparel they are
 * embedded in the eBay listing's description HTML, not its photo gallery:
 * description images aren't subject to eBay's gallery photo rules, and the
 * buyer sees the chart right where they read about fit. Pure: no I/O.
 */

/** Words in a CJ category or product title that mean it comes in sizes. */
const APPAREL =
  /\b(cloth(es|ing)?|apparel|dress(es)?|gowns?|skirts?|shirts?|t-shirts?|tees?|crop ?tops?|tank ?tops?|blouses?|tunics?|camis?|sweaters?|cardigans?|hoodies?|sweatshirts?|jackets?|coats?|blazers?|vests?|pants|trousers|jeans|denim|leggings|shorts|jumpsuits?|rompers?|overalls?|tracksuits?|pajamas?|sleepwear|loungewear|lingerie|bras?|underwear|panties|briefs|boxers|swimsuits?|swimwear|bikinis?|socks|shoes?|sneakers?|boots?|sandals?|slippers?|heels|loafers|footwear)\b/i;

/** Most images embedded per listing (CJ descriptions can hold a dozen shots). */
const MAX_CHART_IMAGES = 8;

/** Clothing or shoes, judged from the CJ category first, then the title. */
export function isApparel(category: string | null | undefined, title: string | null | undefined) {
  return APPAREL.test(category ?? "") || APPAREL.test(title ?? "");
}

/** The description images to embed as the size chart: HTTPS only (eBay rejects others), at most MAX_CHART_IMAGES. */
export function sizeChartImages(input: {
  category?: string | null;
  title?: string | null;
  descriptionImages?: string[] | null;
}): string[] {
  if (!isApparel(input.category, input.title)) return [];
  return (input.descriptionImages ?? [])
    .map((url) => (url.startsWith("//") ? `https:${url}` : url.replace(/^http:\/\//i, "https://")))
    .filter((url) => /^https:\/\/[^\s"'<>]+$/i.test(url))
    .slice(0, MAX_CHART_IMAGES);
}

const attr = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The size chart section appended to the description HTML; empty without images. */
export function sizeChartHtml(images: string[]) {
  if (!images.length) return "";
  const imgs = images
    .map((src) => `<p><img src="${attr(src)}" alt="Size chart" style="max-width:100%;height:auto;" /></p>`)
    .join("\n");
  return `\n<h3>Size Chart</h3>\n<p>Please check the measurements below before ordering.</p>\n${imgs}`;
}

/** Every <img src> in description HTML, in order. */
export function descriptionImageSources(html: string) {
  return [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}
