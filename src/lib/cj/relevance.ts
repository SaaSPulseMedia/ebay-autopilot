/**
 * Local relevance filter for CJ keyword search. CJ's search is fuzzy (a
 * search for "russian hats" can return pumpkins), so results whose English
 * title shares no keyword with the search are dropped, and the rest re-ranked.
 * Pure: no I/O.
 */

/** Words too common to count as a match on their own. */
const STOPWORDS = new Set([
  "a", "an", "and", "the", "for", "with", "of", "to", "in", "on", "by", "or", "set", "pcs", "new",
]);

/** Search keyword → distinct lowercase words, punctuation stripped, stopwords dropped. */
export function keywordWords(keyword: string): string[] {
  const words = keyword
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  return [...new Set(words)];
}

function titleTokens(title: string): string[] {
  return title.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter(Boolean);
}

/** Singular-ish form: "hats" → "hat", "boxes" → "box". Short words are left alone. */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Whole-word match with simple plurals, so "hat" matches "Hats" but not
 * "chat"; stems of 4+ letters also match longer forms ("lamp" → "lamps", "lampshade").
 */
function tokensMatch(tokens: string[], word: string) {
  const s = stem(word);
  return tokens.some(
    (t) => t === word || t === s || t === `${s}s` || t === `${s}es` || stem(t) === s || (s.length >= 4 && t.startsWith(s)),
  );
}

export type RelevanceResult<T> = { kept: T[]; rejected: number; words: string[] };

/**
 * Drops items whose title matches none of the keyword's words, then orders the
 * rest: all words matched → first; the longest word matched → next; any other
 * single word → last. CJ's own order is kept within each group.
 */
export function rankByRelevance<T>(items: T[], keyword: string, titleOf: (item: T) => string): RelevanceResult<T> {
  const words = keywordWords(keyword);
  if (!words.length) return { kept: items, rejected: 0, words };
  const longest = words.reduce((a, b) => (b.length > a.length ? b : a));

  const tiers: T[][] = [[], [], []];
  let rejected = 0;
  for (const item of items) {
    const tokens = titleTokens(titleOf(item));
    const hits = words.filter((w) => tokensMatch(tokens, w));
    if (!hits.length) rejected++;
    else if (hits.length === words.length) tiers[0].push(item);
    else if (hits.includes(longest)) tiers[1].push(item);
    else tiers[2].push(item);
  }
  return { kept: tiers.flat(), rejected, words };
}
