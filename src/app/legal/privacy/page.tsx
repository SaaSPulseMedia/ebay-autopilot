import Link from "next/link";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Link href="/" className="text-sm text-brand-400 hover:text-brand-500">
        ← Back to site
      </Link>
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">Privacy policy</h1>
      <div className="mt-6 space-y-4 text-sm leading-relaxed text-slate-300">
        <p>
          We store the email address you sign up with, a bcrypt hash of your password, your store name if you provide
          one, and the listings and orders you create in the product. We do not sell personal data.
        </p>
        <p>
          If you connect an eBay store over OAuth, we store the access and refresh tokens eBay issues. We never receive
          your eBay password in that flow, and you can revoke the tokens from eBay at any time.
        </p>
        <p>
          If a future release of the browser-fallback engine requires sign-in credentials, those credentials are
          encrypted at rest with AES-256-GCM using a key held only in a server-side environment variable, are never sent
          to the browser or written to logs, and can be deleted in one click from Settings.
        </p>
        <p>
          Session cookies are HTTP-only, SameSite=Lax, and marked Secure in production. API keys for Stripe, Anthropic,
          eBay, and supplier feeds are read only on the server and are never exposed to the client bundle.
        </p>
      </div>
    </main>
  );
}
