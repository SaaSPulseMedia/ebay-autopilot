import "server-only";

import { and, eq, gte, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { autoOrderSettings, cjOrders, users } from "@/db/schema";
import { placeCjOrder, prepareCjOrder } from "@/lib/auto-fulfillment";
import {
  getCjBalance,
  getCjOrder,
  payCjOrderFromBalance,
} from "@/lib/cj/orders";
import { fetchEbayOrders } from "@/lib/ebay/orders";
import { realProfit } from "@/lib/listing-defaults";
import { getListingDefaults } from "@/lib/seller-settings";

/**
 * Automatic ordering: every hour, each new eBay sale of a CJ product is
 * ordered on CJ without the seller pressing anything.
 *  - "create": the CJ order is created (buyer's address from eBay, the exact
 *    variant from the eBay SKU, CJ's cheapest shipping that can go out) and
 *    checked; the seller pays it in CJ.
 *  - "pay": the same, then paid from the CJ wallet when every check passes:
 *    CJ's real total keeps the sale out of a loss, is within the per-order
 *    and 24-hour limits, and the wallet has enough.
 * Anything it can't do safely is left with the reason ("held", or created
 * but unpaid) for the seller to finish by hand. Only eBay orders placed after
 * it was switched on are touched, so orders already bought by hand are never
 * bought twice. Buyer details go from eBay to CJ only, never stored or logged.
 */

export type AutoOrderMode = "off" | "create" | "pay";
export type AutoOrderSettings = {
  mode: AutoOrderMode;
  maxOrder: number;
  maxDay: number;
  enabledAt: Date | null;
};

const DEFAULTS: AutoOrderSettings = {
  mode: "off",
  maxOrder: 40,
  maxDay: 150,
  enabledAt: null,
};
/** eBay orders older than this are never ordered automatically. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** One order takes ~15 s of CJ calls (1.1 s apart); none starts with less time left than this. */
const ORDER_BUDGET_MS = 20_000;

/**
 * The CJ account (CJ_API_KEY) is the store owner's: only that seller's
 * orders may be paid from its wallet. CJ_ACCOUNT_OWNER_EMAIL names them
 * (default: the store's original seller).
 */
const walletOwnerEmail = () =>
  (process.env.CJ_ACCOUNT_OWNER_EMAIL ?? "itsy@store.com").trim().toLowerCase();

export async function ownsCjWallet(userId: number) {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (
    Boolean(row?.email) && row.email.trim().toLowerCase() === walletOwnerEmail()
  );
}

export async function getAutoOrderSettings(
  userId: number,
): Promise<AutoOrderSettings> {
  const [row] = await db
    .select()
    .from(autoOrderSettings)
    .where(eq(autoOrderSettings.userId, userId))
    .limit(1);
  if (!row) return DEFAULTS;
  const mode =
    (["off", "create", "pay"] as const).find((m) => m === row.mode) ?? "off";
  return {
    mode,
    maxOrder: row.maxOrder,
    maxDay: row.maxDay,
    enabledAt: row.enabledAt,
  };
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n)
    ? Math.min(max, Math.max(min, Math.round(n * 100) / 100))
    : fallback;
};

export async function saveAutoOrderSettings(
  userId: number,
  input: { mode?: unknown; maxOrder?: unknown; maxDay?: unknown },
) {
  const current = await getAutoOrderSettings(userId);
  let mode =
    (["off", "create", "pay"] as const).find((m) => m === input.mode) ??
    current.mode;
  if (mode === "pay" && !(await ownsCjWallet(userId))) mode = "create";
  const maxOrder = clamp(input.maxOrder, 5, 500, current.maxOrder);
  const maxDay = clamp(
    input.maxDay,
    maxOrder,
    5000,
    Math.max(current.maxDay, maxOrder),
  );
  // Switching on (from off) starts the clock: only sales after now are ordered.
  const enabledAt =
    mode === "off"
      ? null
      : current.mode === "off"
        ? new Date()
        : current.enabledAt;
  const values = { mode, maxOrder, maxDay, enabledAt, updatedAt: new Date() };
  await db
    .insert(autoOrderSettings)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: autoOrderSettings.userId, set: values });
  return { mode, maxOrder, maxDay, enabledAt } satisfies AutoOrderSettings;
}

export async function sellersWithAutoOrdering() {
  const rows = await db
    .select({ userId: autoOrderSettings.userId })
    .from(autoOrderSettings)
    .where(ne(autoOrderSettings.mode, "off"));
  return rows.map((r) => r.userId);
}

const money = (n: number) => `$${n.toFixed(2)}`;

/** A sale automatic ordering won't order: recorded with why, for the seller to do by hand. */
async function hold(userId: number, ebayOrderId: string, reason: string) {
  const values = {
    userId,
    ebayOrderId,
    cjOrderNumber: ebayOrderId,
    status: "held",
    auto: true,
    error: reason,
    note: null,
    updatedAt: new Date(),
  };
  await db
    .insert(cjOrders)
    .values(values)
    .onConflictDoUpdate({
      target: [cjOrders.userId, cjOrders.ebayOrderId],
      set: values,
    });
  console.info(
    `[auto-order] user ${userId} eBay order ${ebayOrderId}: held: ${reason}`,
  );
  return "held" as const;
}

async function setRecord(
  userId: number,
  ebayOrderId: string,
  set: Partial<typeof cjOrders.$inferInsert>,
) {
  await db
    .update(cjOrders)
    .set({ ...set, updatedAt: new Date() })
    .where(
      and(eq(cjOrders.userId, userId), eq(cjOrders.ebayOrderId, ebayOrderId)),
    );
}

/** Paid automatically in the last 24 hours (USD). */
async function paidLastDay(userId: number) {
  const [row] = await db
    .select({ total: sql<string | null>`sum(${cjOrders.amount})` })
    .from(cjOrders)
    .where(
      and(
        eq(cjOrders.userId, userId),
        eq(cjOrders.auto, true),
        gte(cjOrders.paidAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    );
  return Number(row?.total ?? 0);
}

export type AutoOrderRun = {
  ordered: number;
  paid: number;
  held: number;
  skipped: number;
  errors: number;
};

/** One automatic-ordering pass for a seller: new eBay sales of CJ products, until `deadline`. */
export async function runAutoOrdering(
  userId: number,
  deadline: number,
): Promise<AutoOrderRun> {
  const run: AutoOrderRun = {
    ordered: 0,
    paid: 0,
    held: 0,
    skipped: 0,
    errors: 0,
  };
  const settings = await getAutoOrderSettings(userId);
  if (settings.mode === "off" || !settings.enabledAt) return run;
  const canPay = settings.mode === "pay" && (await ownsCjWallet(userId));

  const result = await fetchEbayOrders(userId, { awaitingOnly: true });
  if (!result.ok) {
    console.warn(
      `[auto-order] user ${userId}: eBay orders unavailable: ${result.error}`,
    );
    run.errors++;
    return run;
  }
  const since = Math.max(settings.enabledAt.getTime(), Date.now() - MAX_AGE_MS);
  const fresh = result.orders.filter(
    (o) =>
      o.fulfillmentStatus === "NOT_STARTED" &&
      o.paymentStatus === "PAID" &&
      new Date(o.createdAt).getTime() >= since,
  );
  if (!fresh.length) return run;

  const known = new Set(
    (
      await db
        .select({ id: cjOrders.ebayOrderId })
        .from(cjOrders)
        .where(and(eq(cjOrders.userId, userId), eq(cjOrders.sandbox, false)))
    ).map((r) => r.id),
  );
  const defaults = await getListingDefaults(userId);

  // Oldest first: the buyer who has waited longest is served first.
  for (const order of fresh.sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (known.has(order.orderId)) continue;
    if (Date.now() > deadline - ORDER_BUDGET_MS) break;

    const prepared = await prepareCjOrder(userId, order.orderId);
    if (!prepared.ok) {
      run.errors++;
      continue;
    }
    const { lines, shipping, shippingError } = prepared.data;
    // Not a CJ product at all (e.g. an AliExpress listing): not automatic ordering's business.
    if (!lines.some((line) => line.match)) {
      run.skipped++;
      continue;
    }
    const unsure = lines.find((line) => !line.match?.cjSku);
    if (unsure) {
      await hold(
        userId,
        order.orderId,
        `"${unsure.title}" can't be matched to one exact CJ variant. Order it by hand with Fulfill on CJ.`,
      );
      run.held++;
      continue;
    }
    const method = shipping[0];
    if (!method) {
      await hold(
        userId,
        order.orderId,
        shippingError ??
          "CJ has no shipping method to the US for this product right now.",
      );
      run.held++;
      continue;
    }
    if (
      !order.shipTo?.addressLine1 ||
      !order.shipTo.city ||
      !order.shipTo.postalCode
    ) {
      await hold(
        userId,
        order.orderId,
        "eBay didn't give a full shipping address. Check the order in Seller Hub.",
      );
      run.held++;
      continue;
    }

    // Claim the sale first, so two runs at once (the hourly job and "Run now") never order it twice.
    const claimed = await db
      .insert(cjOrders)
      .values({
        userId,
        ebayOrderId: order.orderId,
        cjOrderNumber: order.orderId,
        status: "held",
        auto: true,
        error: "Being ordered on CJ…",
      })
      .onConflictDoNothing()
      .returning({ id: cjOrders.ebayOrderId });
    if (!claimed.length) continue;

    const placed = await placeCjOrder(userId, {
      ebayOrderId: order.orderId,
      skus: Object.fromEntries(
        lines.map((line) => [line.lineItemId, line.match?.cjSku ?? ""]),
      ),
      logisticName: method.method,
      fromCountryCode: method.from,
      sandbox: false,
      auto: true,
    });
    if (!placed.ok) {
      // placeCjOrder recorded the failure ("error") with CJ's reason.
      run.errors++;
      continue;
    }
    run.ordered++;
    const cjOrderId = placed.record.cjOrderId ?? "";
    if (placed.record.error) {
      // Created, but CJ didn't take it to Awaiting Payment: the seller finishes it in CJ.
      await setRecord(userId, order.orderId, {
        note: "Created on CJ automatically.",
      });
      continue;
    }

    // CJ's real total (product + shipping), after the shipping method was set.
    const detail = await getCjOrder(cjOrderId);
    const amount =
      (detail.ok ? detail.data.amount : null) ??
      (placed.record.amount != null ? Number(placed.record.amount) : null);
    const sale = order.saleValue;
    const profit =
      amount != null && sale != null
        ? Math.round(realProfit(defaults, sale, amount, 0) * 100) / 100
        : null;
    const keeps =
      profit == null
        ? ""
        : profit < 0
          ? ` This sale loses about ${money(-profit)} after eBay fees.`
          : ` You keep about ${money(profit)} after eBay fees.`;
    const total = amount != null ? money(amount) : "an unknown amount";
    const finishByHand = (why: string) =>
      setRecord(userId, order.orderId, {
        ...(amount != null ? { amount: amount.toFixed(2) } : {}),
        note: `Created on CJ automatically (${total}, ${method.method}).${keeps}`,
        error: `${why} Pay it in CJ → Orders → Store Orders → Awaiting Payment.`,
      });

    if (!canPay) {
      await setRecord(userId, order.orderId, {
        ...(amount != null ? { amount: amount.toFixed(2) } : {}),
        note: `Created and checked on CJ automatically: ${total} with ${method.method}.${keeps} Pay it in CJ → Orders → Store Orders → Awaiting Payment.`,
      });
      continue;
    }
    if (amount == null) {
      await finishByHand(
        "CJ didn't give the order total, so it wasn't paid automatically.",
      );
      continue;
    }
    if (profit != null && profit < 0) {
      await finishByHand(
        `Not paid automatically: at ${total} this sale loses ${money(-profit)}.`,
      );
      continue;
    }
    if (amount > settings.maxOrder) {
      await finishByHand(
        `Not paid automatically: ${total} is over your ${money(settings.maxOrder)} limit per order.`,
      );
      continue;
    }
    const today = await paidLastDay(userId);
    if (today + amount > settings.maxDay) {
      await finishByHand(
        `Not paid automatically: it would take today's automatic payments over your ${money(settings.maxDay)} daily limit.`,
      );
      continue;
    }
    const balance = await getCjBalance();
    if (!balance.ok || balance.data < amount) {
      await finishByHand(
        balance.ok
          ? `Not paid automatically: your CJ wallet has ${money(balance.data)}, the order is ${total}. Add money to your CJ wallet.`
          : `Not paid automatically: CJ didn't give your wallet balance (${balance.error}).`,
      );
      continue;
    }
    const paid = await payCjOrderFromBalance(cjOrderId, placed.shipmentOrderId);
    if (!paid.ok) {
      console.warn(
        `[auto-order] user ${userId} eBay order ${order.orderId}: CJ wallet payment failed: ${paid.error}`,
      );
      await finishByHand(`CJ didn't take the wallet payment (${paid.error}).`);
      continue;
    }
    run.paid++;
    console.info(
      `[auto-order] user ${userId} eBay order ${order.orderId}: CJ order ${cjOrderId} paid ${total} from the CJ wallet`,
    );
    await setRecord(userId, order.orderId, {
      status: "paid",
      amount: amount.toFixed(2),
      paidAt: new Date(),
      error: null,
      note: `Ordered and paid automatically: ${total} from your CJ wallet, ${method.method}.${keeps} Tracking goes on eBay when CJ ships.`,
    });
  }
  console.log(`[auto-order] user ${userId}: ${JSON.stringify(run)}`);
  return run;
}
