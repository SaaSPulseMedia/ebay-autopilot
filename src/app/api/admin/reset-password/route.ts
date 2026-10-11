import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { hasAdminToken } from "@/lib/admin-token";
import { hashPassword } from "@/lib/auth";

/**
 * Admin one-off: sets a new password for an account (there is no self-serve
 * reset flow). Hashes with the same bcrypt helper as signup/login. Needs the
 * `x-admin-token: <CRON_SECRET>` header. Never logs the email or password.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasAdminToken(request)) return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Body must be JSON." }, { status: 400 });
  }
  const { email, newPassword } = (body ?? {}) as { email?: unknown; newPassword?: unknown };
  if (typeof email !== "string" || !email.trim()) {
    return Response.json({ ok: false, error: "email is required." }, { status: 400 });
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return Response.json({ ok: false, error: "newPassword must be at least 8 characters." }, { status: 400 });
  }

  try {
    // Same normalization as registerUser/loginUser.
    const normalized = email.trim().toLowerCase();
    const passwordHash = await hashPassword(newPassword);
    const updated = await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.email, normalized))
      .returning({ id: users.id });
    if (!updated.length) return Response.json({ ok: false, error: "User not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Password reset failed." }, { status: 500 });
  }
}
