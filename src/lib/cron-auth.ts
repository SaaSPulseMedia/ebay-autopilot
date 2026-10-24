import { timingSafeEqual } from "node:crypto";

/** True when the request carries the CRON_SECRET bearer token (the GitHub Actions schedule). */
export function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
