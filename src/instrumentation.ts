/**
 * Runs once when a server instance starts, before it handles requests.
 * Adds any columns introduced after launch to the production database (see
 * src/db/ensure-columns.ts). Never blocks startup on failure: it logs, and
 * POST /api/admin/migrate-ebay-policies can apply the same change by hand.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  try {
    const [{ db }, { ensureAddedColumns }] = await Promise.all([import("@/db"), import("@/db/ensure-columns")]);
    const { added } = await ensureAddedColumns(db);
    if (added.length) console.log("[schema] added columns:", added.join(", "));
  } catch (error) {
    console.error("[schema] could not check for new columns:", error instanceof Error ? error.message : error);
  }
}
