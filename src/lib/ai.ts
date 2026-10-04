import "server-only";

export type ListingCopyInput = {
  title: string;
  category?: string;
  supplierPrice?: number;
  listPrice?: number;
  bullets?: string[];
};

export type ListingCopy = {
  title: string;
  subtitle: string;
  bullets: string[];
  description: string;
  itemSpecifics: Record<string, string>;
  source: "claude" | "template";
};

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514";

function titleCase(value: string) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Deterministic fallback so listing generation never blocks on an API key. */
export function templateCopy(input: ListingCopyInput): ListingCopy {
  const clean = input.title.replace(/\s+/g, " ").trim();
  const keyword = titleCase(clean.split(" ").slice(0, 6).join(" "));
  const category = input.category ? titleCase(input.category) : "Everyday Essentials";
  const bullets = input.bullets?.length
    ? input.bullets
    : [
        `${keyword} shipped from a US supplier`,
        "Brand-new, factory-sealed stock",
        "Tracked delivery, typically 2–5 business days",
        "30-day returns handled through eBay",
      ];
  return {
    title: `${keyword} | ${category} | Fast US Shipping`.slice(0, 80),
    subtitle: `${category} · ships from the US`,
    bullets,
    description: [
      `${keyword}`,
      "",
      bullets.map((b) => `• ${b}`).join("\n"),
      "",
      "Ordered before 2pm ET on a business day? Your item is routed to the supplier the same afternoon and tracking is uploaded to eBay automatically.",
    ].join("\n"),
    itemSpecifics: {
      Condition: "New",
      Brand: "Unbranded",
      Category: category,
      "Ships From": "United States",
    },
    source: "template",
  };
}

/** Claude wrapper. Falls back to the template when no key is configured or the call fails. */
export async function generateListingCopy(input: ListingCopyInput): Promise<ListingCopy> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return templateCopy(input);

  const prompt = `You write eBay listings for a US dropshipping seller.
Return STRICT JSON with keys: title (<=80 chars), subtitle, bullets (4 strings), description (plain text), itemSpecifics (object of string->string).
Never invent certifications, reviews, ratings or brand endorsements. No emoji.
Product: ${input.title}
Category: ${input.category ?? "unknown"}
Target list price: ${input.listPrice ?? "unknown"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) return templateCopy(input);
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = json.content?.find((part) => part.type === "text")?.text ?? "";
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return templateCopy(input);
    const parsed = JSON.parse(match[0]) as Partial<ListingCopy>;
    const fallback = templateCopy(input);
    return {
      title: (parsed.title ?? fallback.title).slice(0, 80),
      subtitle: parsed.subtitle ?? fallback.subtitle,
      bullets: parsed.bullets?.length ? parsed.bullets : fallback.bullets,
      description: parsed.description ?? fallback.description,
      itemSpecifics: parsed.itemSpecifics ?? fallback.itemSpecifics,
      source: "claude",
    };
  } catch {
    return templateCopy(input);
  }
}
