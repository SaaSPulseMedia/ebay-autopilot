/**
 * Plain product facts pulled from CJ data for listing copy: the description as
 * text, "Name: value" spec lines, the packing list, weight, dimensions and
 * material. Pure: no I/O. Only what CJ actually sent is kept; nothing is guessed.
 */

export type ProductFacts = {
  /** CJ's description as plain text (no HTML), trimmed to a sane length. */
  description: string;
  /** "Material: ABS" style lines from the description. */
  specs: { name: string; value: string }[];
  /** Packing-list entries, e.g. "1 x Phone holder". */
  included: string[];
  /** Product weight in grams; 0 when unknown. */
  weightGrams: number;
  /** Length × width × height as CJ sends them (assumed millimetres); null when unknown. */
  dimensionsMm: { length: number; width: number; height: number } | null;
  material: string;
};

const MAX_DESCRIPTION = 3000;
const MAX_SPECS = 15;
const MAX_INCLUDED = 8;

const CJ_MENTION = /(?:https?:\/\/)?(?:[\w-]+\.)*cjdropshipping\.com[^\s]*/gi;
const URL = /https?:\/\/\S+/gi;
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** HTML → plain text, one line per block element. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  return String(html)
    .replace(/<(script|style)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#?\w+);/g, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(CJ_MENTION, "")
    .replace(URL, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Section headings CJ uses; not specs themselves. */
const HEADING = /^(product (information|info|details|description)|specifications?|features?|description|note|notes|tips?)\s*:?\s*$/i;
const PACKING_HEADING = /^(packing list|package (includes|included|contents?|list)|what'?s in the box|in the box)\s*:?\s*(.*)$/i;
const SPEC_LINE = /^([A-Za-z][A-Za-z0-9 /&().-]{0,29}?)\s*[:：]\s*(.+)$/;
/** Spec names that are instructions or seller notes rather than product facts. */
const NOT_A_SPEC = /^(note|notes|tips?|warning|attention|please|reminder|shipping|delivery|service)$/i;

/** "Phone holder*1" / "Phone holder x 1" → "1 x Phone holder". */
function packingItem(raw: string) {
  const text = raw.replace(/^[-•*\d.)\s]+(?=[A-Za-z])/, "").trim();
  const match = text.match(/^(.*?)\s*[*xX×]\s*(\d+)\s*(?:pcs?|pieces?|sets?)?$/);
  return match && match[1] ? `${match[2]} x ${match[1].trim()}` : text;
}

/** CJ sometimes JSON-encodes lists ('["Plastic","ABS"]'). */
function listText(value: unknown): string {
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" && v.trim()).join(", ");
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.startsWith("[")) {
    try {
      return listText(JSON.parse(raw));
    } catch {
      // not JSON; use as-is
    }
  }
  return raw;
}

export function extractFacts(input: {
  descriptionHtml?: string | null;
  weightGrams?: number;
  material?: unknown;
  dimensionsMm?: ProductFacts["dimensionsMm"];
}): ProductFacts {
  const text = htmlToText(input.descriptionHtml);
  const specs: ProductFacts["specs"] = [];
  const included: string[] = [];
  let inPacking = false;

  for (const line of text.split("\n")) {
    const packing = line.match(PACKING_HEADING);
    if (packing) {
      inPacking = true;
      // "Packing list: 1 x holder, 1 x clip" on one line.
      for (const part of packing[3].split(/[,;]/)) if (part.trim()) included.push(packingItem(part));
      continue;
    }
    if (HEADING.test(line)) {
      inPacking = false;
      continue;
    }
    if (inPacking) {
      if (line.length <= 80) included.push(packingItem(line));
      continue;
    }
    const spec = line.match(SPEC_LINE);
    if (spec && !NOT_A_SPEC.test(spec[1].trim()) && spec[2].length <= 120) {
      specs.push({ name: spec[1].trim(), value: spec[2].trim() });
    }
  }

  const specMaterial = specs.find((s) => /^material$/i.test(s.name))?.value ?? "";
  return {
    description: text.slice(0, MAX_DESCRIPTION),
    specs: specs.slice(0, MAX_SPECS),
    included: [...new Set(included.filter(Boolean))].slice(0, MAX_INCLUDED),
    weightGrams: input.weightGrams && input.weightGrams > 0 ? Math.round(input.weightGrams) : 0,
    dimensionsMm: input.dimensionsMm ?? null,
    material: listText(input.material) || specMaterial,
  };
}
