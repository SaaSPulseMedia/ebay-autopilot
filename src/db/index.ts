import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Lazy Postgres pool + Drizzle client.
 *
 * `next build` imports the whole module graph while collecting page data,
 * including on hosts where DATABASE_URL only exists at runtime. Connecting —
 * or even validating the variable — at import time makes the build fail with
 * "DATABASE_URL is required" before a single page renders. So both are
 * deferred until the first real query.
 */

const globalForDb = globalThis as typeof globalThis & {
  __autopilotPool?: Pool;
};

function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Postgres database in Vercel (Storage tab) or set DATABASE_URL in Settings → Environment Variables, then redeploy.",
    );
  }

  if (!globalForDb.__autopilotPool) {
    globalForDb.__autopilotPool = new Pool({
      connectionString: url,
      // Serverless functions are short-lived; keep the pool small so a burst
      // of invocations cannot exhaust Postgres' connection limit.
      max: 5,
      idleTimeoutMillis: 20_000,
      connectionTimeoutMillis: 10_000,
    });
  }

  return globalForDb.__autopilotPool;
}

/** Property access is forwarded to a memoised instance, so importing is free. */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    const instance = drizzle(getPool());
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return Reflect.has(drizzle(getPool()), prop);
  },
});

/** Raw pool, kept for the seed script and `pool.end()`. */
export const pool = {
  query: (...args: Parameters<Pool["query"]>) => getPool().query(...args),
  connect: () => getPool().connect(),
  end: () => getPool().end(),
  get totalCount() {
    return getPool().totalCount;
  },
  get idleCount() {
    return getPool().idleCount;
  },
  get waitingCount() {
    return getPool().waitingCount;
  },
};
