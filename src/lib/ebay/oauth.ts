import "server-only";

/**
 * eBay OAuth scaffold.
 *
 * Authorization-URL building is real; the token exchange is intentionally left as a
 * scaffold for the next milestone. Every secret stays on the server.
 */

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
    redirectUri: process.env.EBAY_REDIRECT_URI ?? "",
    sandbox: process.env.EBAY_SANDBOX === "true",
  };
}

export function isEbayConfigured() {
  const env = ebayEnv();
  return Boolean(env.clientId && env.clientSecret && env.redirectUri);
}

export function authorizeUrl(state: string) {
  const env = ebayEnv();
  const host = env.sandbox ? "auth.sandbox.ebay.com" : "auth.ebay.com";
  const url = new URL(`https://${host}/oauth2/authorize`);
  url.searchParams.set("client_id", env.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("scope", EBAY_SCOPES.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export type EbayTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  demo: boolean;
};

/**
 * TODO (next session): real authorization-code exchange against
 * https://api.ebay.com/identity/v1/oauth2/token using HTTP Basic auth.
 */
export async function exchangeCodeForTokens(code: string): Promise<EbayTokens> {
  if (!isEbayConfigured()) {
    return {
      accessToken: `demo-token-${code.slice(0, 8)}`,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      demo: true,
    };
  }
  return {
    accessToken: `pending-exchange-${code.slice(0, 8)}`,
    refreshToken: null,
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
    demo: true,
  };
}
