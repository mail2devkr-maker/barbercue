import { Prisma } from '@prisma/client';

/** Units counted as whole items — only these can be sold one-by-one in the shop. */
export const SELLABLE_UNITS = ['EACH', 'PACK', 'BOX'] as const;

type Db =
  | Prisma.TransactionClient
  | { $queryRaw: Prisma.TransactionClient['$queryRaw'] };

/**
 * Units of each inventory product held by open shop orders. A PLACED order only holds stock until
 * its accept-by time; accepted / preparing / ready orders hold it until collected or cancelled.
 */
export async function reservedUnits(
  db: Db,
  inventoryProductIds: string[],
): Promise<Map<string, number>> {
  if (!inventoryProductIds.length) return new Map();
  const rows = await db.$queryRaw<
    Array<{ id: string; qty: bigint }>
  >(Prisma.sql`
    SELECT i."inventoryProductId" AS "id", COALESCE(SUM(i."quantity"), 0)::bigint AS "qty"
    FROM "shop_order_items" i JOIN "shop_orders" o ON o."id" = i."orderId"
    WHERE i."inventoryProductId" IN (${Prisma.join(inventoryProductIds)})
      AND (o."status" IN ('ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP')
           OR (o."status" = 'PLACED' AND o."acceptBy" > now()))
    GROUP BY i."inventoryProductId"`);
  return new Map(rows.map((r) => [r.id, Number(r.qty)]));
}

/** Whole units a customer can still order: stock on hand minus open orders, never below zero. */
export function availableUnits(
  stockOnHand: Prisma.Decimal | string | number,
  reserved: number,
): number {
  return Math.max(0, Math.floor(Number(stockOnHand)) - reserved);
}

export function availabilityLabel(
  available: number,
): 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' {
  return available <= 0
    ? 'OUT_OF_STOCK'
    : available <= 3
      ? 'LOW_STOCK'
      : 'IN_STOCK';
}

export function commissionPercent(): Prisma.Decimal {
  const raw = Number(process.env.SHOP_COMMISSION_PERCENT ?? '0');
  return new Prisma.Decimal(
    Number.isFinite(raw) && raw >= 0 && raw <= 50 ? raw.toFixed(2) : '0',
  );
}

/** Synthetic test products are shown outside production only, unless explicitly allowed. */
export function showTestData(): boolean {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.SHOP_SHOW_TEST_DATA === 'true'
  );
}
