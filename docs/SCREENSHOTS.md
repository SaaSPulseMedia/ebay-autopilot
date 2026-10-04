# Adding real screenshots

Screenshots are optional. The site renders fine without them — the gallery section simply does not appear until at
least one file exists. **Never** commit a mock-up, a stock photo, or an AI-generated image as a product screenshot.

## How to add one

Save the image into `public/images/screenshots/` with the exact slug below. It appears on the homepage automatically;
there is no code to change.

| Slug | What to capture |
| --- | --- |
| `bulk-run` | The Bulk list page with products ticked, showing the variant and profit totals and the **List selected** button |
| `variants` | A product's generated variant rows — size/colour, SKU, price, quantity |
| `research` | The research table showing supplier cost, suggested price, and net profit |

Accepted extensions: `.png`, `.jpg`, `.jpeg`, `.webp`. Use `.png` for UI.

Capture at **1600px wide or more** (a retina screenshot of a maximised browser window is ideal) and keep each file
under about 400 KB — run it through an image compressor before committing.

---

## Must-do redaction checklist

Go through this for **every** screenshot before it is committed. Blur or block out with a solid shape — do not rely
on cropping alone, and never just lower the opacity.

- [ ] **Buyer names** — remove every one
- [ ] **Buyer addresses, postcodes, phone numbers, emails** — remove every one
- [ ] **Order numbers and transaction IDs** — these can identify a buyer
- [ ] **Your own email address** and any account identifier in the header bar
- [ ] **Supplier URLs** if you do not want competitors reading your sources
- [ ] Anything in a browser tab strip, bookmarks bar, or notification popup

Showing a buyer's name and address in marketing material is a personal-data breach. If in doubt, black it out.

---

## What to screenshot, and what not to

**Good — screenshots of our own product**

These are honest, they show what the customer is buying, and we control the UI. Prefer screens with real data in them
over empty states.

**Avoid — screenshots of eBay's own interface** (Seller Hub, the eBay listing form, your eBay dashboard)

Three reasons:

1. **It is not our product.** Showing eBay's UI on our marketing site implies the customer is buying something we do
   not actually provide.
2. **Trademark and endorsement.** Reproducing eBay's interface and branding can read as eBay endorsing us, which they
   have not. Our footer explicitly disclaims affiliation, and the screenshots must not contradict it.
3. **It dates badly.** eBay redesigns; our screenshots would quietly become wrong.

A fair exception is a *small, clearly-labelled* shot of your live eBay listing used to make a specific, true point —
for example "a listing published by AutoPilot, as buyers see it". Label it so nobody thinks it is our interface.

**Never**

- Another seller's store or listings
- Revenue or sales figures that are not genuinely yours
- Anything implying a volume, rating, or review count we cannot substantiate
