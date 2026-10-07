# eBay AutoPilot

**Run your eBay store on autopilot.**

Listing is the job every eBay store owner hates: retyping the title into an 80-character box, filling 20+ item
specifics, re-uploading photos, and building every size and color variant by hand — per product. It is the most
commonly outsourced task in the business.

**eBay AutoPilot replaces that work with one button.** Select up to 50 products, press *List selected*, and the
batch is written by AI, variant-expanded, brand-screened, priced after real eBay fees, and published. Repricing, stock
sync, and automatic order ingestion are in progress.

Built with Next.js 16 (App Router), Drizzle ORM, and PostgreSQL.

---

## What it does

| Area | Detail |
| --- | --- |
| **Bulk listing** | **The core feature. Tick any number of products and publish the whole batch in one run — the same engine handles 1 or 200** |
| **Variants** | **Size, color, and style options expanded into proper multi-variant listings, each row with its own SKU, price, and quantity** |
| Research | Supplier catalog with cost, suggested eBay price, shipping, and net profit after eBay's 13.55% final value fee and $0.40 per-order fee |
| Listing defaults | Settings → Listing defaults (`seller_settings` table): pricing rule (suggested or own markup), ad rate, quantity per variant, handling time, description footer — applied to Bulk list, Paste links, and New listing. Every price has a "Why this price" fee breakdown (`priceBreakdown` in `src/lib/pricing.ts`) and money-losing items are never listed |
| Import | Paste up to 50 supplier links (`/dashboard/import`); each page is read for title, price, and image, priced at your markup, VeRO-screened, and listed with variants. Links to retailers/marketplaces (Amazon, Walmart, etc.) are refused because eBay does not allow filling orders from another retailer (`src/lib/supplier-policy.ts`) |
| AI copy | Claude drafts an 80-character title, bullets, description, and item specifics, with a deterministic template fallback |
| Publishing | Store connection over eBay OAuth is built (`/api/ebay/connect` → `/api/ebay/callback`, state-checked, tokens AES-256-GCM encrypted at rest and auto-refreshed). Publishing through the Sell/Inventory API is **in progress** — until then every listing falls back to demo mode and says so. Headless-Chromium fallback is scaffolded only |
| Plan limits | Active listings are the upgrade driver: 50 on Starter, 200 on Pro, 1,000 on Business. Batch size: 50 per run and up to 20 variants per product on every plan. Limits enforced server-side (non-ended listings counted, typed `plan_limit_reached` error) |
| Maintenance | Built: VeRO brand screening on every listing (`src/lib/vero.ts`); drip posting on Pro/Business — listings are scheduled and released up to 10 per account per hour by `/api/cron/release`, triggered hourly by `.github/workflows/drip-release.yml` (Vercel Hobby cron only runs daily). In progress: supplier re-checks, repricing rules, out-of-stock pause |
| Orders | Fulfillment queue with buyer details, supplier cost, and realized margin, feeding the analytics totals |
| Billing | Stripe Checkout with a demo fallback so the flow is clickable before live keys are added |

Every number shown in the product is computed from the data in that deployment. There are no placeholder metrics and
no testimonials.

## Stack

- Next.js 16 App Router — Server Components for all data reads, `"use client"` only for interactive forms
- Drizzle ORM + PostgreSQL
- Tailwind CSS v4
- `jose` JWT sessions + `bcryptjs` password hashing, HTTP-only cookies
- Server-only secrets: every API key is read in route handlers or server modules and never reaches the client bundle

## Getting started

```bash
npm install
cp .env.example .env        # fill in DATABASE_URL and AUTH_SECRET
npm run db:push             # create tables
npm run db:seed             # load the 24 starter products (example prices)
npm run dev
```

Open http://localhost:3000.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply the Drizzle schema |
| `npm run db:seed` | Load the 24 starter products (example prices) |

## Environment variables

Required:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `AUTH_SECRET` | Signing key for session JWTs (`openssl rand -base64 32`) |

Optional — each has a working fallback:

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_BASE_URL` | Canonical site URL for metadata and Stripe redirects |
| `ANTHROPIC_API_KEY` | Claude listing copy; falls back to the built-in template |
| `ANTHROPIC_MODEL` | Override the Claude model |
| `STRIPE_SECRET_KEY` | Live Stripe Checkout; falls back to demo checkout |
| `CRON_SECRET` | Protects `/api/cron/release` (drip posting). Same value as the GitHub secret `CRON_SECRET` |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | eBay keyset App ID and Cert ID |
| `EBAY_REDIRECT_URI` | The **RuName** (eBay Redirect URL name) shown on the developer portal's User Tokens page — not a URL. Its auth accepted URL must be `https://<your-domain>/api/ebay/callback` |
| `EBAY_AUTH_ORIGIN` | Optional. A second domain of this same deployment **without "ebay" in it** (e.g. `https://autopilot-lister.vercel.app`). eBay's sign-in settings reject privacy/accept URLs on a domain containing "ebay", so the RuName points there: privacy `…/legal/privacy`, accepted **and** declined `…/api/ebay/callback`. The seller is handed over with a 2-minute signed token and returned to `NEXT_PUBLIC_BASE_URL` |
| `TOKEN_ENCRYPTION_KEY` | Optional. Key for encrypting stored eBay tokens; defaults to `AUTH_SECRET`. Changing it means sellers reconnect |
| `EBAY_SANDBOX` | `true` to target eBay sandbox |
| `ENABLE_BROWSER_ENGINE` / `CHROMIUM_EXECUTABLE_PATH` | Enable the headless-Chromium fallback (not implemented yet) |

## Who sets up what

This trips people up, so to be explicit:

| | You (the operator), once | Your customers, ever |
| --- | --- | --- |
| eBay developer account | **Yes** — register one free app at [developer.ebay.com](https://developer.ebay.com) | **No. Never.** |
| eBay app keys (`EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET`) | **Yes** — paste into Vercel env vars | **No** |
| Redirect URI | **Yes** — set it to `https://yourdomain.com/api/ebay/callback` | **No** |
| Connecting a store | Not applicable | **One click.** Press *Connect eBay store*, approve on eBay's screen, done |

You register **one** eBay application for the whole product. Every customer then authorises *your* application against
*their* own eBay account through eBay's standard permission screen — the same flow as "Sign in with Google". A
customer never sees a key, a redirect URI, or any configuration, and they never type their eBay password into our
site.

Until you add the eBay keys, the app runs every customer in demo mode: the full pipeline works and nothing is posted
to eBay.

### Your one-time eBay setup

1. Sign in at [developer.ebay.com](https://developer.ebay.com) with your normal eBay account and join the developer
   program (free).
2. Create a **Production** keyset. Note the App ID (client ID) and Cert ID (client secret).
3. Add an **RuName / redirect URI** pointing at `https://yourdomain.com/api/ebay/callback`.
4. Put `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, and `EBAY_REDIRECT_URI` into your Vercel environment variables.
5. Redeploy. The Connect button now does a real connection for every customer.

## Deploying to Vercel

1. Import the repository on [vercel.com/new](https://vercel.com/new).
2. Add `AUTH_SECRET` on the Configure Project screen before the first deploy.
3. After the first deploy, add Neon Postgres from the **Storage** tab — it injects `DATABASE_URL`.
4. Apply the schema and seed the catalog from your machine:
   ```bash
   vercel link && vercel env pull .env.production
   DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d= -f2-)" npx drizzle-kit push
   DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d= -f2-)" npm run db:seed
   ```
5. Add `NEXT_PUBLIC_BASE_URL` with your production URL and redeploy.

Serverless function memory stays at the default 1024 MB — Chromium is not bundled in this release, so any
"missing Chromium" warning is expected and safe to ignore.

## Roadmap

- Sell/Inventory API publishing (store connection and token refresh are built)
- Encrypted-credentials table and the headless-Chromium listing engine
- Scheduled order ingestion and tracking upload

## Honesty policy

No invented testimonials, no fabricated user counts, no superlative claims. Marketing figures are either generic
truthful statements or values computed at request time from the running deployment. CI fails the build if
unverifiable social-proof strings reappear in `README.md`, `src/`, or `public/`.

eBay AutoPilot is not affiliated with, endorsed by, or sponsored by eBay Inc.

## License

MIT — see [LICENSE](./LICENSE).
