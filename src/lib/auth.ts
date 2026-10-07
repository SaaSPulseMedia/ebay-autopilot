import "server-only";

import { cookies } from "next/headers";
import { createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";

const COOKIE = "ap_session";
const SESSION_DAYS = 14;

let warnedAboutSecret = false;

/**
 * Session signing key.
 *
 * `AUTH_SECRET` is what you should set in production (Vercel env vars). If it is
 * missing — e.g. a preview container that does not load `.env` — we derive a
 * stable 32-byte key from the database credentials instead of hard-failing, so
 * auth still works. The derived key is only as guessable as your DATABASE_URL.
 */
function secret() {
  const configured = process.env.AUTH_SECRET;
  if (configured && configured.length >= 16) {
    return new TextEncoder().encode(configured);
  }

  const seed = process.env.DATABASE_URL;
  if (!seed) {
    throw new Error("Set AUTH_SECRET (or DATABASE_URL) so sessions can be signed.");
  }
  if (!warnedAboutSecret) {
    warnedAboutSecret = true;
    console.warn(
      "[auth] AUTH_SECRET is not set. Using a key derived from DATABASE_URL. Set AUTH_SECRET in your environment for production.",
    );
  }
  return new Uint8Array(createHash("sha256").update(`ebay-autopilot:${seed}`).digest());
}

export type SessionUser = {
  id: number;
  email: string;
  storeName: string | null;
  plan: string;
  trialEndsAt: Date | null;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: number) {
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id, userId, expiresAt });

  const token = await new SignJWT({ sid: id, uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret());
      const sid = payload.sid;
      if (typeof sid === "string") await db.delete(sessions).where(eq(sessions.id, sid));
    } catch {
      // expired or tampered — just clear the cookie
    }
  }
  store.delete(COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = payload.uid;
    if (typeof uid !== "number") return null;
    const [row] = await db.select().from(users).where(eq(users.id, uid)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      storeName: row.storeName,
      plan: row.plan,
      trialEndsAt: row.trialEndsAt,
    };
  } catch {
    return null;
  }
}

export async function registerUser(email: string, password: string, storeName?: string) {
  const normalized = email.trim().toLowerCase();
  const existing = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (existing.length) return { ok: false as const, error: "An account already uses that email." };
  const passwordHash = await hashPassword(password);
  const trialEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(users)
    .values({ email: normalized, passwordHash, storeName: storeName ?? null, trialEndsAt })
    .returning();
  await createSession(row.id);
  return { ok: true as const, userId: row.id };
}

export async function loginUser(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  const [row] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!row) return { ok: false as const, error: "No account found for that email." };
  const valid = await verifyPassword(password, row.passwordHash);
  if (!valid) return { ok: false as const, error: "Incorrect password." };
  await createSession(row.id);
  return { ok: true as const, userId: row.id };
}

/**
 * Short-lived signed token for a single purpose (e.g. handing an eBay connection
 * from the main site to the eBay-facing domain). Signed with the session key, so
 * it cannot be forged; it carries only a user id and a few extra claims.
 */
export async function signPurposeToken(
  purpose: string,
  userId: number,
  extra: Record<string, string> = {},
  ttl = "10m",
) {
  return new SignJWT({ ...extra, uid: userId, purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secret());
}

export async function verifyPurposeToken(
  token: string | null | undefined,
  purpose: string,
): Promise<{ uid: number; claims: Record<string, unknown> } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.purpose !== purpose || typeof payload.uid !== "number") return null;
    return { uid: payload.uid, claims: payload as Record<string, unknown> };
  } catch {
    return null;
  }
}
