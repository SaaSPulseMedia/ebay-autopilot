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

/** Lines that open a note: "Note:", "Notes", "Tips:", "Attention:", "Reminder:". */
const NOTE_LEAD = /^(?:\d+[.)]\s*)?(notes?|tips?|attention|reminder|warm prompt)\b\s*[:：.-]?\s*/i;
/** A bare note heading with its text on the following lines. */
const NOTE_HEADING = /^(notes?|tips?|attention|reminder|warm prompt)\s*[:：]?\s*$/i;
/** Wording that makes a line a sizing warning on its own, even without "Note:". */
const SIZING_WARNING =
  /\b(asian sizes?|asia sizes?|smaller than|larger than|bigger than|size chart|size guide|manual(ly)? measur\w*|measur\w* (error|deviation|difference)|\d\s*-\s*\d\s*cm (error|deviation|difference)|tolerance|size up|one size up|(choose|select|order) (a|one) (larger|bigger) size|please (check|refer to|compare|allow)\b.*\b(size|measure\w*))/i;
/** A note only counts when it is about size or fit. */
const ABOUT_SIZE = /\b(sizes?|sizing|measur\w*|cm|inch(es)?|fit|fits|smaller|larger|bigger|tight|loose)\b/i;
/** Spec-like lines ("Size: S M L") are the chart's own data, not warnings. */
const SPEC_LIKE = /^[A-Za-z][A-Za-z /&-]{0,20}[:：]\s*\S/;
const MAX_NOTES = 4;
const MAX_NOTE_LENGTH = 400;

/**
 * The sizing warnings in CJ's description text (e.g. "Note: Asian sizes are
 * 1 to 2 sizes smaller than European and American sizes…"): lines that open
 * with "Note:"/"Tips:" or follow a bare "Note:" heading and are about size or
 * fit, plus lines with clear sizing-warning wording. Returned without their
 * "Note:" lead-in, in order, de-duplicated, at most MAX_NOTES. Pure.
 */
export function sizeNotes(text: string | null | undefined): string[] {
  const notes: string[] = [];
  let underHeading = 0;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line) continue;
    if (NOTE_HEADING.test(line)) {
      underHeading = 3; // the next few lines are the note's text
      continue;
    }
    const lead = NOTE_LEAD.test(line);
    const inNote = underHeading > 0;
    if (underHeading > 0) underHeading -= 1;
    const isNote = (lead || inNote) && ABOUT_SIZE.test(line);
    const isWarning = SIZING_WARNING.test(line) && !(SPEC_LIKE.test(line) && !lead);
    if (!isNote && !isWarning) continue;
    const body = line.replace(NOTE_LEAD, "").replace(/^[-•*\d.)\s]+/, "").trim();
    if (body.length < 12) continue;
    notes.push(body.length > MAX_NOTE_LENGTH ? `${body.slice(0, MAX_NOTE_LENGTH - 1)}…` : body);
  }
  return [...new Set(notes)].slice(0, MAX_NOTES);
}

const text = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * The size chart section appended to the description HTML: the chart images,
 * then CJ's sizing notes right below them with "Note:" in bold at a normal
 * reading size so buyers see them. Notes alone (no chart images) still get a
 * "Sizing" section. Empty when there is neither.
 */
export function sizeChartHtml(images: string[], notes: string[] = []) {
  if (!images.length && !notes.length) return "";
  const imgs = images
    .map((src) => `<p><img src="${attr(src)}" alt="Size chart" style="max-width:100%;height:auto;" /></p>`)
    .join("\n");
  const noteHtml = notes
    .map((note) => `<p style="font-size:14px;line-height:1.5;"><strong>Note:</strong> ${text(note)}</p>`)
    .join("\n");
  const heading = images.length
    ? `<h3>Size Chart</h3>\n<p>Please check the measurements below before ordering.</p>`
    : `<h3>Sizing</h3>`;
  return `\n${heading}\n${[imgs, noteHtml].filter(Boolean).join("\n")}`;
}

/** Every <img src> in description HTML, in order. */
export function descriptionImageSources(html: string) {
  return [...html.matchAll(/<img\b[^>]*?\bsrc="([^"]+)"/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}
