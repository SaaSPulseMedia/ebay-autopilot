import "server-only";

import { timingSafeEqual } from "node:crypto";

/** True when the request's `x-admin-token` header equals CRON_SECRET. Always false if CRON_SECRET is unset. */
export function hasAdminToken(request: Request) {
  const expected = process.env.CRON_SECRET;
  const given = request.headers.get("x-admin-token");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
