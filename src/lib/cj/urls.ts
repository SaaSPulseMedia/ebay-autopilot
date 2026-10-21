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

/**
 * The CJ product id in a CJ product link, or null for any other link:
 * ".../product/<slug>-p-<pid>.html" (CJ's product pages) or
 * ".../product-detail.html?id=<pid>" (older links).
 */
export function cjPidFromUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== "cjdropshipping.com" && !host.endsWith(".cjdropshipping.com")) return null;
  const fromPath = url.pathname.match(/-p-([A-Za-z0-9-]+)\.html$/)?.[1];
  const fromQuery = url.searchParams.get("id") ?? url.searchParams.get("pid");
  const pid = fromPath ?? fromQuery;
  return pid && /^[A-Za-z0-9-]{4,64}$/.test(pid) ? pid : null;
}
