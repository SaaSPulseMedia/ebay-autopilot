import "server-only";

export type ExtractedProduct = {
  url: string;
  title: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  supplier: string;
  ok: boolean;
  note?: string;
};

function pick(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function decode(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fetches a supplier product page and pulls title / price / image out of OG + JSON-LD markup. */
export async function extractProduct(rawUrl: string): Promise<ExtractedProduct> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { url: rawUrl, title: "", price: null, currency: "USD", imageUrl: null, supplier: "unknown", ok: false, note: "That does not look like a valid URL." };
  }

  const supplier = url.hostname.replace(/^www\./, "");
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; eBayAutoPilot/1.0; +https://github.com/SaaSPulseMedia/ebay-autopilot)",
        accept: "text/html,application/xhtml+xml",
      },
      next: { revalidate: 900 },
    });
    if (!res.ok) {
      return { url: url.toString(), title: "", price: null, currency: "USD", imageUrl: null, supplier, ok: false, note: `Supplier returned HTTP ${res.status}.` };
    }
    const html = (await res.text()).slice(0, 400_000);

    const title =
      pick(html, [
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
        /"name"\s*:\s*"([^"]{5,180})"/,
        /<title[^>]*>([^<]{3,200})<\/title>/i,
      ]) ?? "";

    const priceRaw = pick(html, [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i,
      /"price"\s*:\s*"?([0-9]+(?:\.[0-9]{1,2})?)"?/,
      /\$\s?([0-9]{1,5}(?:\.[0-9]{2}))/,
    ]);

    const imageUrl = pick(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /"image"\s*:\s*"([^"]+)"/,
    ]);

    const currency = pick(html, [/"priceCurrency"\s*:\s*"([A-Z]{3})"/]) ?? "USD";

    return {
      url: url.toString(),
      title: title ? decode(title) : "",
      price: priceRaw ? Number(priceRaw) : null,
      currency,
      imageUrl: imageUrl ? decode(imageUrl) : null,
      supplier,
      ok: Boolean(title),
      note: title ? undefined : "Could not read the product title — paste it manually.",
    };
  } catch {
    return { url: url.toString(), title: "", price: null, currency: "USD", imageUrl: null, supplier, ok: false, note: "Supplier page could not be reached from the server." };
  }
}
