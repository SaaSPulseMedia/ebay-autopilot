import "server-only";

/**
 * Cleans CJ's product description HTML for display. Allowlist, not blocklist:
 * only plain formatting tags survive, and every attribute is dropped, so the
 * output can carry no scripts, event handlers, styles or links. Removed:
 *   - script/style/iframe/object/svg/… elements with their contents
 *   - <a> tags (their text stays) and every <img>
 *   - cjdropshipping.com mentions and bare image URLs in the text
 */

const ALLOWED = new Set([
  "p", "br", "div", "span", "b", "strong", "i", "em", "u", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "td", "th", "hr",
]);
const VOID = new Set(["br", "hr"]);
/** Elements whose contents are dropped along with the tags. */
const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "textarea", "title", "head", "select", "button", "form"];
/** Headings are demoted so the description can't outshout the modal's own title. */
const HEADING_TO = "h4";

const CJ_MENTION = /(?:https?:\/\/)?(?:[\w-]+\.)*cjdropshipping\.com[^\s<]*/gi;
const IMAGE_URL = /https?:\/\/[^\s<"']+\.(?:jpe?g|png|gif|webp|bmp|avif)(?:\?[^\s<"']*)?/gi;

function cleanText(text: string) {
  return text.replace(CJ_MENTION, "").replace(IMAGE_URL, "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeCjDescription(input: string | null | undefined): string {
  if (!input) return "";
  let html = String(input).replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, "gi"), "");
  }

  let out = "";
  // Split into tags and text; anything that isn't a well-formed tag is treated as text and escaped.
  for (const part of html.split(/(<\/?[a-zA-Z][^<>]*>)/g)) {
    const tag = part.endsWith(">") ? part.match(/^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/) : null;
    if (!tag) {
      out += cleanText(part);
      continue;
    }
    const closing = tag[1] === "/";
    let name = tag[2].toLowerCase();
    if (!ALLOWED.has(name)) continue;
    if (/^h[1-6]$/.test(name)) name = HEADING_TO;
    if (VOID.has(name)) {
      if (!closing) out += `<${name}>`;
      continue;
    }
    out += closing ? `</${name}>` : `<${name}>`;
  }

  return out
    .replace(/<(p|div|span|li|b|strong|i|em|u|h4)>\s*(?:&nbsp;|\s|<br>)*\s*<\/\1>/gi, "")
    .replace(/(?:<br>\s*){3,}/gi, "<br><br>")
    .trim();
}
