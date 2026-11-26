import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  SHOP_ACCEPT_WINDOW_HOURS,
  SHOP_ORDER_STATUS_LABEL,
  SHOP_ORDER_TRANSITIONS,
  canTransition,
  fromPaise,
  toPaise,
  type InventoryPageDto,
  type ShopCartQuoteInput,
  type ShopCheckoutInput,
  type ShopCheckoutResultDto,
  type ShopOrderDto,
  type ShopOrderListQuery,
  type ShopOrderStatus,
  type ShopOrderTransitionInput,
  type ShopQuoteDto,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { availableUnits, reservedUnits } from './shop-stock';
import { armCommerceOutbox } from '../commerce/commerce-outbox-signal';

type Actor = 'SELLER' | 'CUSTOMER' | 'SYSTEM' | 'ADMIN';

const orderInclude = {
  items: { orderBy: { productName: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
  salon: {
    select: {
      id: true,
      name: true,
      addressLine: true,
      phone: true,
      city: { select: { name: true } },
    },
  },
} satisfies Prisma.ShopOrderInclude;
type OrderRow = Prisma.ShopOrderGetPayload<{ include: typeof orderInclude }>;

const fail = (code: string, message: string, status = HttpStatus.BAD_REQUEST) =>
  new AppException(code, message, status);

function tokenSecret(): string {
  const secret =
    process.env.SHOP_ORDER_TOKEN_SECRET || process.env.JWT_ACCESS_SECRET;
  if (!secret)
    throw new Error(
      'SHOP_ORDER_TOKEN_SECRET (or JWT_ACCESS_SECRET) must be set',
    );
  return secret;
}
/** The guest's order-link secret, derived (not stored) so a retried checkout can return it again. */
export function orderAccessToken(orderId: string): string {
  return createHmac('sha256', tokenSecret())
    .update(`shop-order:${orderId}`)
    .digest('base64url');
}
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export function toOrderDto(o: OrderRow, viewer: Actor): ShopOrderDto {
  const allowed = Object.entries(SHOP_ORDER_TRANSITIONS[o.status])
    .filter(([, who]) => who?.includes(viewer))
    .map(([to]) => to as ShopOrderStatus);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    statusLabel: SHOP_ORDER_STATUS_LABEL[o.status],
    fulfillment: o.fulfillment,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    salon: {
      id: o.salon.id,
      name: o.salon.name,
      address: o.salon.addressLine,
      city: o.salon.city?.name ?? null,
      phone: o.salon.phone,
    },
    contactName: o.contactName,
    contactPhone: o.contactPhone,
    contactEmail: o.contactEmail,
    note: o.note,
    items: o.items.map((i) => ({
      productId: i.globalProductId,
      name: i.productName,
      brand: i.brand,
      variant: i.variant,
      barcode: i.barcode,
      quantity: i.quantity,
      unitPrice: i.unitPrice.toFixed(2),
      lineTotal: i.lineTotal.toFixed(2),
    })),
    subtotal: o.subtotal.toFixed(2),
    discountTotal: o.discountTotal.toFixed(2),
    total: o.total.toFixed(2),
    currency: o.currency,
    placedAt: o.placedAt.toISOString(),
    acceptBy: o.acceptBy.toISOString(),
    acceptedAt: o.acceptedAt?.toISOString() ?? null,
    readyAt: o.readyAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    cancelReason: o.cancelReason,
    events: o.events.map((e) => ({
      toStatus: e.toStatus,
      actorKind: e.actorKind,
      note: e.note,
      at: e.createdAt.toISOString(),
    })),
    allowedTransitions:
      o.status === 'PLACED' && o.acceptBy < new Date() ? [] : allowed,
  };
}

/**
 * Marketplace orders. One salon per order, pickup at the salon, paid at the salon (online payment is
 * not switched on, so the platform never marks anything paid by itself). Placing an order locks the
 * salon's inventory rows, re-reads prices and stock, and reserves units; collecting it takes the
 * units off stock through the ledger (ADJUSTMENT with the order number as the reason).
 */
@Injectable()
export class ShopOrderService {
  private readonly log = new Logger(ShopOrderService.name);
  constructor(private readonly prisma: PrismaService) {}

  private async loadListings(
    db: Prisma.TransactionClient | PrismaService,
    ids: string[],
  ) {
    return db.shopListing.findMany({
      where: { id: { in: ids } },
      include: {
        salon: {
          select: {
            id: true,
            name: true,
            status: true,
            addressLine: true,
            city: { select: { name: true } },
          },
        },
        inventoryProduct: {
          select: { id: true, stockOnHand: true, isActive: true },
        },
        globalProduct: {
          select: {
            id: true,
            name: true,
            brand: true,
            variantText: true,
            verificationStatus: true,
            isTestData: true,
            barcodes: { select: { display: true }, take: 1 },
          },
        },
      },
    });
  }

  /** Server-priced cart: what each line costs now, whether it can be bought, and the total. */
  async quote(
    input: ShopCartQuoteInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ShopQuoteDto> {
    const merged = new Map<string, number>();
    for (const line of input.items)
      merged.set(
        line.listingId,
        (merged.get(line.listingId) ?? 0) + line.quantity,
      );
    const listings = await this.loadListings(db, [...merged.keys()]);
    const reserved = await reservedUnits(
      db,
      listings.map((l) => l.inventoryProductId),
    );
    const blocking: string[] = [];
    const salonIds = new Set(listings.map((l) => l.salonId));
    if (salonIds.size > 1)
      blocking.push(
        'Your bag has products from more than one salon. Each order is collected from one salon, so check out one salon at a time.',
      );
    if (listings.length < merged.size)
      blocking.push(
        'Some products are no longer sold. Remove them to continue.',
      );
    let subtotal = 0;
    let savings = 0;
    const lines = listings.map((l) => {
      const quantity = merged.get(l.id)!;
      const available = availableUnits(
        l.inventoryProduct.stockOnHand,
        reserved.get(l.inventoryProductId) ?? 0,
      );
      let problem: string | null = null;
      if (
        l.status !== 'APPROVED' ||
        l.salon.status !== 'ACTIVE' ||
        !l.inventoryProduct.isActive ||
        l.globalProduct.verificationStatus !== 'VERIFIED'
      )
        problem = 'No longer sold by this salon.';
      else if (available <= 0) problem = 'Out of stock at this salon.';
      else if (quantity > available)
        problem = `Only ${available} left at this salon.`;
      else if (quantity > l.maxPerOrder)
        problem = `At most ${l.maxPerOrder} per order.`;
      if (problem) blocking.push(`${l.globalProduct.name}: ${problem}`);
      const unit = toPaise(l.price.toFixed(2));
      subtotal += unit * quantity;
      if (l.compareAtPrice)
        savings += (toPaise(l.compareAtPrice.toFixed(2)) - unit) * quantity;
      return {
        listingId: l.id,
        productId: l.globalProductId,
        name: l.globalProduct.name,
        brand: l.globalProduct.brand,
        variant: l.globalProduct.variantText,
        quantity,
        unitPrice: l.price.toFixed(2),
        compareAtPrice: l.compareAtPrice?.toFixed(2) ?? null,
        lineTotal: fromPaise(unit * quantity),
        availableQuantity: available,
        maxPerOrder: l.maxPerOrder,
        problem,
      };
    });
    const salon = listings[0]?.salon;
    return {
      salon: salon
        ? {
            id: salon.id,
            name: salon.name,
            address: salon.addressLine,
            city: salon.city?.name ?? null,
          }
        : null,
      lines,
      subtotal: fromPaise(subtotal),
      discountTotal: '0.00', // promotions are not configured yet; the listing price already includes the salon's offer
      savings: fromPaise(Math.max(0, savings)),
      total: fromPaise(subtotal),
      currency: 'INR',
      blocking: [...new Set(blocking)],
    };
  }

  async checkout(
    input: ShopCheckoutInput,
    idempotencyKey: string | undefined,
    customerUserId: string | null,
  ): Promise<ShopCheckoutResultDto> {
    const key = idempotencyKey?.trim();
    if (!key || !/^[A-Za-z0-9_:-]{8,120}$/.test(key))
      throw fail(
        'IDEMPOTENCY_KEY_REQUIRED',
        'An Idempotency-Key header (8–120 letters, digits, - _ :) is required.',
      );
    const scopedKey = `shop:${key}`;
    const existing = await this.prisma.shopOrder.findUnique({
      where: { idempotencyKey: scopedKey },
      include: orderInclude,
    });
    if (existing) {
      if (existing.customerUserId !== customerUserId)
        throw fail(
          'SHOP_IDEMPOTENCY_CONFLICT',
          'This checkout key was already used.',
          HttpStatus.CONFLICT,
        );
      return {
        order: toOrderDto(existing, 'CUSTOMER'),
        accessToken: orderAccessToken(existing.id),
        created: false,
      };
    }
    try {
      const order = await this.prisma.$transaction(
        async (tx) => {
          const listings = await tx.shopListing.findMany({
            where: { id: { in: input.items.map((i) => i.listingId) } },
            select: { inventoryProductId: true },
          });
          // Lock the salon's stock rows (fixed order → no deadlocks) so two checkouts can't both take the last unit.
          const productIds = [
            ...new Set(listings.map((l) => l.inventoryProductId)),
          ].sort();
          if (productIds.length)
            await tx.$queryRaw(
              Prisma.sql`SELECT "id" FROM "inventory_products" WHERE "id" IN (${Prisma.join(productIds)}) ORDER BY "id" FOR UPDATE`,
            );
          const quote = await this.quote({ items: input.items }, tx);
          if (quote.blocking.length)
            throw fail(
              'SHOP_CART_INVALID',
              quote.blocking.join(' '),
              HttpStatus.CONFLICT,
            );
          if (!quote.salon)
            throw fail('SHOP_CART_INVALID', 'Your bag is empty.');
          if (toPaise(input.expectedTotal) !== toPaise(quote.total))
            throw fail(
              'SHOP_PRICE_CHANGED',
              `Prices changed since you opened your bag. The total is now ₹${quote.total}; review and place the order again.`,
              HttpStatus.CONFLICT,
            );
          const full = await this.loadListings(
            tx,
            quote.lines.map((l) => l.listingId),
          );
          const byId = new Map(full.map((l) => [l.id, l]));
          const now = new Date();
          const created = await tx.shopOrder.create({
            data: {
              orderNumber: `FQS-${randomBytes(5).toString('hex').toUpperCase()}`,
              salonId: quote.salon.id,
              customerUserId,
              contactName: input.contactName,
              contactPhone: input.contactPhone.replace(/[\s-]/g, ''),
              contactEmail: input.contactEmail || null,
              note: input.note || null,
              accessTokenHash: 'pending',
              idempotencyKey: scopedKey,
              subtotal: quote.subtotal,
              total: quote.total,
              acceptBy: new Date(
                now.getTime() + SHOP_ACCEPT_WINDOW_HOURS * 3600_000,
              ),
              items: {
                create: quote.lines.map((line) => {
                  const l = byId.get(line.listingId)!;
                  return {
                    listingId: l.id,
                    inventoryProductId: l.inventoryProductId,
                    globalProductId: l.globalProductId,
                    quantity: line.quantity,
                    unitPrice: line.unitPrice,
                    compareAtPrice: line.compareAtPrice,
                    lineTotal: line.lineTotal,
                    productName: l.globalProduct.name.slice(0, 160),
                    brand: l.globalProduct.brand,
                    variant: l.globalProduct.variantText,
                    barcode: l.globalProduct.barcodes[0]?.display ?? null,
                  };
                }),
              },
              events: {
                create: {
                  toStatus: 'PLACED',
                  actorKind: customerUserId ? 'CUSTOMER' : 'GUEST',
                  actorUserId: customerUserId,
                },
              },
            },
          });
          await tx.shopOrder.update({
            where: { id: created.id },
            data: { accessTokenHash: sha256(orderAccessToken(created.id)) },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: customerUserId,
              action: 'SHOP_ORDER_PLACED',
              entityType: 'ShopOrder',
              entityId: created.id,
              metadata: {
                salonId: quote.salon.id,
                total: quote.total,
                lines: quote.lines.length,
                guest: !customerUserId,
              },
            },
          });
          return tx.shopOrder.findUniqueOrThrow({
            where: { id: created.id },
            include: orderInclude,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 15000,
          maxWait: 10000,
        },
      );
      armCommerceOutbox(); // after commit: the outbox sweep tells the salon about the new order
      return {
        order: toOrderDto(order, 'CUSTOMER'),
        accessToken: orderAccessToken(order.id),
        created: true,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.shopOrder.findUnique({
          where: { idempotencyKey: scopedKey },
          include: orderInclude,
        });
        if (raced && raced.customerUserId === customerUserId)
          return {
            order: toOrderDto(raced, 'CUSTOMER'),
            accessToken: orderAccessToken(raced.id),
            created: false,
          };
      }
      throw error;
    }
  }

  /** A guest opens their order with the number and the secret from their order link. */
  async getForGuest(orderNumber: string, token: string): Promise<ShopOrderDto> {
    const order = await this.prisma.shopOrder.findUnique({
      where: { orderNumber },
      include: orderInclude,
    });
    const ok =
      !!order &&
      order.accessTokenHash.length === 64 &&
      timingSafeEqual(
        Buffer.from(order.accessTokenHash, 'hex'),
        Buffer.from(sha256(token), 'hex'),
      );
    if (!order || !ok)
      throw fail(
        'SHOP_ORDER_NOT_FOUND',
        'Order not found. Check the link from your order confirmation.',
        HttpStatus.NOT_FOUND,
      );
    return toOrderDto(order, 'CUSTOMER');
  }

  async cancelForGuest(
    orderNumber: string,
    token: string,
    reason?: string,
  ): Promise<ShopOrderDto> {
    const order = await this.getForGuest(orderNumber, token);
    return this.transition(
      order.id,
      { to: 'CANCELLED', note: reason || 'Cancelled by the customer' },
      'CUSTOMER',
      null,
    );
  }

  async listForCustomer(userId: string): Promise<ShopOrderDto[]> {
    const rows = await this.prisma.shopOrder.findMany({
      where: { customerUserId: userId },
      include: orderInclude,
      orderBy: { placedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => toOrderDto(r, 'CUSTOMER'));
  }

  async getForCustomer(
    userId: string,
    orderNumber: string,
  ): Promise<ShopOrderDto> {
    const row = await this.prisma.shopOrder.findFirst({
      where: { orderNumber, customerUserId: userId },
      include: orderInclude,
    });
    if (!row)
      throw fail(
        'SHOP_ORDER_NOT_FOUND',
        'Order not found.',
        HttpStatus.NOT_FOUND,
      );
    return toOrderDto(row, 'CUSTOMER');
  }

  async cancelForCustomer(
    userId: string,
    orderNumber: string,
    reason?: string,
  ): Promise<ShopOrderDto> {
    const order = await this.getForCustomer(userId, orderNumber);
    return this.transition(
      order.id,
      { to: 'CANCELLED', note: reason || 'Cancelled by the customer' },
      'CUSTOMER',
      userId,
    );
  }

  async listForSalon(
    salonId: string | null,
    query: ShopOrderListQuery,
    viewer: Actor,
  ): Promise<InventoryPageDto<ShopOrderDto>> {
    const rows = await this.prisma.shopOrder.findMany({
      where: {
        ...(salonId
          ? { salonId }
          : query.salonId
            ? { salonId: query.salonId }
            : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.cursor ? { id: { lt: query.cursor } } : {}),
      },
      include: orderInclude,
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((r) => toOrderDto(r, viewer)),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * The only way an order's status changes: checks the allowed transition for this actor, claims
   * the order with a compare-and-set on its current status, and (on collection) takes the units off
   * the salon's stock through the ledger in the same transaction. Retrying the same step is a no-op.
   */
  async transition(
    orderId: string,
    input: ShopOrderTransitionInput,
    actor: Actor,
    actorUserId: string | null,
    salonScope?: string,
  ): Promise<ShopOrderDto> {
    const updated = await this.prisma.$transaction(
      async (tx) => {
        const order = await tx.shopOrder.findUnique({
          where: { id: orderId },
          include: { items: true },
        });
        if (!order || (salonScope && order.salonId !== salonScope))
          throw fail(
            'SHOP_ORDER_NOT_FOUND',
            'Order not found.',
            HttpStatus.NOT_FOUND,
          );
        if (order.status === input.to) return order.id; // retry of the same step
        if (
          order.status === 'PLACED' &&
          order.acceptBy < new Date() &&
          input.to !== 'EXPIRED'
        )
          throw fail(
            'SHOP_ORDER_EXPIRED',
            'This order was not accepted in time and has expired.',
            HttpStatus.CONFLICT,
          );
        if (!canTransition(order.status, input.to, actor))
          throw fail(
            'SHOP_ORDER_TRANSITION',
            `An order that is "${SHOP_ORDER_STATUS_LABEL[order.status]}" cannot be moved to "${SHOP_ORDER_STATUS_LABEL[input.to]}".`,
            HttpStatus.CONFLICT,
          );
        if (
          input.to === 'COMPLETED' &&
          order.paymentMethod === 'PAY_AT_SALON' &&
          !input.paidAtSalon
        )
          throw fail(
            'SHOP_PAYMENT_NOT_CONFIRMED',
            'Confirm that the customer paid at the salon before marking the order collected.',
          );
        const now = new Date();
        const claimed = await tx.shopOrder.updateMany({
          where: { id: order.id, status: order.status },
          data: {
            status: input.to,
            ...(input.to === 'ACCEPTED' ? { acceptedAt: now } : {}),
            ...(input.to === 'READY_FOR_PICKUP' ? { readyAt: now } : {}),
            ...(input.to === 'COMPLETED'
              ? { completedAt: now, paymentStatus: 'PAID_AT_SALON' }
              : {}),
            ...(input.to === 'CANCELLED' || input.to === 'EXPIRED'
              ? {
                  cancelledAt: now,
                  cancelReason: input.note?.slice(0, 300) ?? null,
                }
              : {}),
          },
        });
        if (!claimed.count)
          throw fail(
            'SHOP_ORDER_CHANGED',
            'The order was just updated by someone else. Refresh and try again.',
            HttpStatus.CONFLICT,
          );
        if (input.to === 'COMPLETED') {
          const sellerUserId =
            actorUserId ??
            (
              await tx.salon.findUniqueOrThrow({
                where: { id: order.salonId },
                select: { ownerUserId: true },
              })
            ).ownerUserId;
          for (const item of order.items) {
            const key = `shop-sale:${item.id}`;
            const movement = await tx.inventoryMovement.create({
              data: {
                salonId: order.salonId,
                productId: item.inventoryProductId,
                actorUserId: sellerUserId,
                kind: 'ADJUSTMENT',
                quantityDelta: new Prisma.Decimal(-item.quantity),
                reason: `Sold — Marketplace order ${order.orderNumber}`,
                reference: order.orderNumber,
                idempotencyKey: key,
                requestHash: sha256(key),
              },
              select: { id: true },
            });
            await tx.shopOrderItem.update({
              where: { id: item.id },
              data: { stockMovementId: movement.id },
            });
          }
        }
        await tx.shopOrderEvent.create({
          data: {
            orderId: order.id,
            fromStatus: order.status,
            toStatus: input.to,
            actorKind: actor,
            actorUserId,
            note: input.note?.slice(0, 300) ?? null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: `SHOP_ORDER_${input.to}`,
            entityType: 'ShopOrder',
            entityId: order.id,
            metadata: { from: order.status, actor, salonId: order.salonId },
          },
        });
        return order.id;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
        maxWait: 10000,
      },
    );
    armCommerceOutbox(); // after commit: the outbox sweep collects the status event
    const row = await this.prisma.shopOrder.findUniqueOrThrow({
      where: { id: updated },
      include: orderInclude,
    });
    return toOrderDto(row, actor);
  }

  /** Orders nobody accepted in time stop holding stock (they already stop counting at acceptBy). */
  @Cron('*/10 * * * *')
  async expireStale(): Promise<number> {
    const stale = await this.prisma.shopOrder.findMany({
      where: { status: 'PLACED', acceptBy: { lt: new Date() } },
      select: { id: true },
      take: 200,
    });
    let n = 0;
    for (const o of stale) {
      try {
        await this.transition(
          o.id,
          { to: 'EXPIRED', note: 'Not accepted in time' },
          'SYSTEM',
          null,
        );
        n += 1;
      } catch (error) {
        this.log.warn(
          `Could not expire shop order ${o.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return n;
  }
}
