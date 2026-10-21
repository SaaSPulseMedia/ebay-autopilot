/** CJ product links. Pure: no I/O, so client and server code can share it. */

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

/** CJ's product page; CJ reads the id after "-p-", the slug is for humans. */
export function cjProductUrl(pid: string, title: string) {
  return `https://cjdropshipping.com/product/${slug(title) || "product"}-p-${encodeURIComponent(pid)}.html`;
}

/** The CJ product id inside an AutoPilot catalog id ("cj-<pid>"), or null for non-CJ products. */
export function cjPidOf(externalId: string | null | undefined) {
  return externalId?.startsWith("cj-") ? externalId.slice(3) || null : null;
}
