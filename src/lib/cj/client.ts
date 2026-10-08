import "server-only";

/**
 * CJ Dropshipping API v2 client (diagnostic stage: nothing is stored).
 *
 * Auth: an API key from the CJ dashboard is exchanged for an access token,
 * which every call sends in the `CJ-Access-Token` header. The key's format is
 * not assumed — it is passed through as-is.
 */

export const CJ_BASE_URL = "https://developers.cjdropshipping.com/api2.0/v1";

export type CjJson = Record<string, unknown>;

export type CjToken = {
  token: string;
  expiresAt: Date;
  /** Which response field the expiry came from, so we learn CJ's real shape. */
  expirySource: "accessTokenExpiryDate" | "expiresIn" | "default";
  /** Response field names, for diagnostics (no values). */
  responseFields: string[];
};

export type CjTokenResult = ({ ok: true } & CjToken) | { ok: false; error: string; status?: number; body?: unknown };

/** CJ token lifetime is documented as both 15 and 180 days; assume the shorter. */
const DEFAULT_TOKEN_LIFETIME_MS = 15 * 24 * 60 * 60 * 1000;

/** Tokens cached per server instance; CJ allows 1 token request/second. */
const tokenCache = new Map<string, CjToken>();

function asRecord(value: unknown): CjJson | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as CjJson) : null;
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 2000) };
  }
}

export async function getCjAccessToken(apiKey: string): Promise<CjTokenResult> {
  const cached = tokenCache.get(apiKey);
  if (cached && cached.expiresAt.getTime() - Date.now() > 60 * 60 * 1000) return { ok: true, ...cached };

  try {
    const res = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ apiKey }),
      cache: "no-store",
    });
    const body = await readJson(res);
    const root = asRecord(body);
    const data = asRecord(root?.data);
    const token = typeof data?.accessToken === "string" ? data.accessToken : null;
    if (!res.ok || !token) {
      const message = typeof root?.message === "string" ? root.message : `CJ returned HTTP ${res.status}`;
      return { ok: false, error: message, status: res.status, body };
    }

    let expiresAt = new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
    let expirySource: CjToken["expirySource"] = "default";
    const expiryDate = data?.accessTokenExpiryDate;
    const expiresIn = data?.expiresIn;
    if (typeof expiryDate === "string" || typeof expiryDate === "number") {
      const parsed = new Date(expiryDate);
      if (!Number.isNaN(parsed.getTime())) {
        expiresAt = parsed;
        expirySource = "accessTokenExpiryDate";
      }
    } else if (typeof expiresIn === "number" && expiresIn > 0) {
      expiresAt = new Date(Date.now() + expiresIn * 1000);
      expirySource = "expiresIn";
    }

    const entry: CjToken = {
      token,
      expiresAt,
      expirySource,
      responseFields: [...Object.keys(root ?? {}), ...Object.keys(data ?? {}).map((k) => `data.${k}`)],
    };
    tokenCache.set(apiKey, entry);
    return { ok: true, ...entry };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach CJ." };
  }
}

/**
 * Calls a CJ path (e.g. "/product/list?pageNum=1"). Never throws: returns the
 * parsed JSON, or `{ ok: false, error, status }` when CJ can't be reached or
 * answers with something that isn't JSON.
 */
export async function cjFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<unknown> {
  try {
    const res = await fetch(`${CJ_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        "CJ-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const body = await readJson(res);
    if (!res.ok && !asRecord(body)) return { ok: false, status: res.status, error: `CJ returned HTTP ${res.status}` };
    return body;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not reach CJ." };
  }
}
