import "server-only";

/**
 * eBay OAuth (authorization code grant) for connecting a seller's store.
 *
 * Flow: /api/ebay/connect sends the seller to eBay's own sign-in and consent
 * screen → eBay redirects to the "auth accepted URL" configured for our RuName
 * (/api/ebay/callback) with ?code=…&state=… → we exchange the code for tokens.
 *
 * EBAY_REDIRECT_URI holds the RuName ("eBay Redirect URL name"), not a URL —
 * eBay requires that value as redirect_uri in both the authorize and token calls.
 * Every secret stays on the server.
 */

/** HTTP-only cookie holding the one-time OAuth state between /connect and /callback. */
export const EBAY_STATE_COOKIE = "ap_ebay_state";
/** Purpose claim of the signed token stored in that cookie. */
export const EBAY_STATE_PURPOSE = "ebay-state";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
];

export function ebayEnv() {
  return {
    clientId: process.env.EBAY_CLIENT_ID ?? "",
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? "",
    ruName: process.env.EBAY_REDIRECT_URI ?? "",
    sandbox: process.env.EBAY_SANDBOX === "true",
  };
}

export function isEbayConfigured() {
  const env = ebayEnv();
  return Boolean(env.clientId && env.clientSecret && env.ruName);
}

export function isEbaySandbox() {
  return ebayEnv().sandbox;
}

function originOf(value: string | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The origin the browser actually asked for. Behind Vercel's proxy (and locally)
 * `request.url` can carry a normalised host, so prefer the forwarded headers.
 */
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return originOf(`${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`) ?? url.origin;
}

/**
 * Domain eBay talks to (privacy policy, auth accepted/declined URLs). eBay's
 * sign-in settings reject URLs on a domain containing "ebay", so the connection
 * can run on a second domain (EBAY_AUTH_ORIGIN) of the same deployment.
 * Falls back to wherever the request came from.
 */
export function ebayAuthOrigin(request: Request) {
  return originOf(process.env.EBAY_AUTH_ORIGIN) ?? requestOrigin(request);
}

/** Where sellers use the dashboard (sessions live on this domain). */
export function siteOrigin(request: Request) {
  return originOf(process.env.NEXT_PUBLIC_BASE_URL) ?? requestOrigin(request);
}

function hosts() {
  return ebayEnv().sandbox
    ? { auth: "https://auth.sandbox.ebay.com", api: "https://api.sandbox.ebay.com" }
    : { auth: "https://auth.ebay.com", api: "https://api.ebay.com" };
}

export function authorizeUrl(state: string) {
  const env = ebayEnv();
  const url = new URL("/oauth2/authorize", hosts().auth);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.ruName);
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  // eBay's docs separate scopes with %20; URLSearchParams would write "+".
  return url.toString().replace(/\+/g, "%20");
}

export type EbayTokens = {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
};

export type TokenResult = { ok: true; tokens: EbayTokens } | { ok: false; error: string };

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
};

async function tokenRequest(body: URLSearchParams): Promise<TokenResult> {
  const env = ebayEnv();
  const basic = Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64");
  try {
    const res = await fetch(new URL("/identity/v1/oauth2/token", hosts().api), {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as TokenResponse;
    if (!res.ok || !json.access_token) {
      return { ok: false, error: json.error_description || json.error || `eBay returned HTTP ${res.status}` };
    }
    const now = Date.now();
    return {
      ok: true,
      tokens: {
        accessToken: json.access_token,
        accessTokenExpiresAt: new Date(now + (json.expires_in ?? 7200) * 1000),
        refreshToken: json.refresh_token ?? null,
        refreshTokenExpiresAt: json.refresh_token_expires_in
          ? new Date(now + json.refresh_token_expires_in * 1000)
          : null,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach eBay." };
  }
}

/** Swap the one-time code from eBay's redirect for an access token + refresh token. */
export function exchangeCodeForTokens(code: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: ebayEnv().ruName }),
  );
}

/** Access tokens last about 2 hours; the refresh token gets a new one without the seller. */
export function refreshAccessToken(refreshToken: string) {
  return tokenRequest(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: EBAY_SCOPES.join(" ") }),
  );
}
