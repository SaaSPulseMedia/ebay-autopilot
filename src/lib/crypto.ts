import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for secrets we must store, such as eBay access and
 * refresh tokens. The key comes from TOKEN_ENCRYPTION_KEY, falling back to
 * AUTH_SECRET (and, like the session key, DATABASE_URL as a last resort).
 *
 * Changing that key makes stored tokens unreadable; sellers simply reconnect.
 */
function key() {
  const material = process.env.TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.DATABASE_URL;
  if (!material) throw new Error("Set TOKEN_ENCRYPTION_KEY or AUTH_SECRET so tokens can be encrypted.");
  return createHash("sha256").update(`autopilot-token-key:${material}`).digest();
}

const VERSION = "v1";

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(":");
}

/** Returns null (never throws) when the value is missing, tampered with, or from an old key. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [version, iv, tag, body] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
