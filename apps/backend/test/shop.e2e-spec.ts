import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
  gtinCheckDigit,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';
import { ShopOrderService } from '../src/shop/shop-order.service';

process.env.JWT_ACCESS_SECRET ??= 'shop-e2e-only-jwt-secret';
process.env.TOTP_ENCRYPTION_KEY ??= 'shop-e2e-only-encryption-secret';
process.env.SHOP_COMMISSION_PERCENT = '10';

let disposable = false;
try {
  const u = new URL(process.env.DATABASE_URL ?? '');
  disposable =
    ['127.0.0.1', 'localhost'].includes(u.hostname) &&
    ['owner_ops_chain', 'inventory_certification'].includes(
      u.pathname.replace(/^\//, ''),
    );
} catch {
  disposable = false;
}
const maybe = disposable ? describe : describe.skip;
const run = Math.floor(Math.random() * 1e6)
  .toString()
  .padStart(6, '0');
let serial = 0;
const ean = () => {
  serial += 1;
  const body = `28${run}${String(serial).padStart(4, '0')}`;
  return `${body}${gtinCheckDigit(body)}`;
};

maybe('Marketplace (authenticated, disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const api = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    token?: string,
    key?: string,
  ) => {
    const r = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) r.set('Authorization', `Bearer ${token}`);
    if (key) r.set('Idempotency-Key', key);
    return r;
  };
  const owner = (salon: string) => `dashboard/salons/${ids[salon]}`;

  /** A salon stocks the catalog product (real ledger opening stock) and lists it; admin approves. */
  async function sell(
    salon: 'A' | 'B',
    productId: string,
    qty: number,
    price: number,
    compareAt?: number,
  ) {
    const added = await api(
      'post',
      `${owner(salon)}/inventory/catalog/add`,
      tok[salon],
    )
      .send({ globalProductId: productId, usage: 'RETAIL' })
      .expect(201);
    const inventoryProductId = added.body.product.id as string;
    await api(
      'post',
      `${owner(salon)}/inventory/products/${inventoryProductId}/movements`,
      tok[salon],
      randomUUID(),
    )
      .send({ kind: 'OPENING', quantity: qty, unitCost: 50 })
      .expect(201);
    const listing = await api(
      'put',
      `${owner(salon)}/shop/listings`,
      tok[salon],
    )
      .send({
        inventoryProductId,
        price,
        ...(compareAt ? { compareAtPrice: compareAt } : {}),
        maxPerOrder: 10,
      })
      .expect(200);
    expect(listing.body.status).toBe('PENDING_APPROVAL');
    return { inventoryProductId, listingId: listing.body.id as string };
  }
  const checkout = (
    items: Array<{ listingId: string; quantity: number }>,
    expectedTotal: string,
    key = randomUUID(),
    token?: string,
  ) =>
    api(
      'post',
      token ? 'customer/shop/orders' : 'shop/orders',
      token,
      key,
    ).send({
      items,
      contactName: 'Test Shopper',
      contactPhone: '+91 98765 43210',
      expectedTotal,
    });

  const p1 = { id: '', barcode: ean() };
  const p2 = { id: '', barcode: ean() };
  let a1: { inventoryProductId: string; listingId: string };
  let b1: { inventoryProductId: string; listingId: string };
  let a2: { inventoryProductId: string; listingId: string };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    const tokens = app.get(TokenService);
    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    const mkUser = async (label: string) =>
      prisma.user.create({
        data: {
          email: `shop-${run}-${label}@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });

    const admin = await mkUser('admin');
    await prisma.userRole.create({
      data: { userId: admin.id, role: Role.PLATFORM_ADMIN },
    });
    tok.admin = tokens.signAccessToken(
      admin.id,
      [Role.PLATFORM_ADMIN],
      SessionAudience.ADMIN,
    );
    const customer = await mkUser('customer');
    await prisma.userRole.create({
      data: { userId: customer.id, role: Role.CUSTOMER },
    });
    tok.customer = tokens.signAccessToken(
      customer.id,
      [Role.CUSTOMER],
      SessionAudience.CUSTOMER,
    );
    ids.customer = customer.id;
    for (const [label, lat, lng] of [
      ['A', 21.85, 84.0],
      ['B', 21.9, 84.1],
    ] as const) {
      const u = await mkUser(label);
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: u.id,
          name: `Shop ${label} ${run}`,
          slug: `shop-${label.toLowerCase()}-${run}`,
          cityId: city.id,
          addressLine: 'Disposable',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
          lat,
          lng,
        },
      });
      await prisma.userRole.create({
        data: { userId: u.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      ids[label] = salon.id;
      tok[label] = tokens.signAccessToken(
        u.id,
        [Role.SALON_OWNER],
        SessionAudience.STAFF,
      );
    }
    for (const [p, name, category] of [
      [p1, `Glow Serum ${run}`, 'Hair Care'],
      [p2, `Glow Cleanser ${run}`, 'Skin Care'],
    ] as const) {
      const row = await prisma.globalProduct.create({
        data: {
          name,
          normalizedName: name.toLowerCase(),
          brand: 'E2E Brand',
          category,
          variantText: '100 ml',
          dataSource: 'ADMIN',
          verificationStatus: 'VERIFIED',
          createdByUserId: admin.id,
          barcodes: {
            create: {
              code: `0${p.barcode}`,
              display: p.barcode,
              format: 'GTIN',
            },
          },
        },
      });
      p.id = row.id;
    }
    a1 = await sell('A', p1.id, 3, 550, 600);
    b1 = await sell('B', p1.id, 5, 525);
    a2 = await sell('A', p2.id, 4, 199);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('only approved listings are sold; admin approval is required and owners cannot approve', async () => {
    let detail = await api('get', `shop/products/${p1.id}`).expect(200);
    expect(detail.body.offers).toHaveLength(0);
    await api('patch', `admin/shop/listings/${a1.listingId}`, tok.A)
      .send({ action: 'APPROVE' })
      .expect(403);
    for (const l of [a1, b1, a2])
      await api('patch', `admin/shop/listings/${l.listingId}`, tok.admin)
        .send({ action: 'APPROVE' })
        .expect(200);
    detail = await api(
      'get',
      `shop/products/${p1.id}?lat=21.9&lng=84.1`,
    ).expect(200);
    expect(
      detail.body.offers.map((o: { salon: { id: string }; price: string }) => [
        o.salon.id,
        o.price,
      ]),
    ).toEqual([
      [ids.B, '525.00'],
      [ids.A, '550.00'],
    ]);
    expect(detail.body.offers[1]).toMatchObject({
      compareAtPrice: '600.00',
      discountPercent: 8,
      availableQuantity: 3,
    });
    expect(detail.body.offers[0].distanceKm).toBe(0);
    expect(detail.body).toMatchObject({
      fromPrice: '525.00',
      sellerCount: 2,
      inStock: true,
    });
  });

  it('search: name, synonyms, barcode, category, price filter and sorting', async () => {
    const byBarcode = await api('get', `shop/products?q=${p1.barcode}`).expect(
      200,
    );
    expect(byBarcode.body.items.map((i: { id: string }) => i.id)).toEqual([
      p1.id,
    ]);
    const byName = await api(
      'get',
      `shop/products?q=glow%20serum%20${run}`,
    ).expect(200);
    expect(byName.body.items[0].id).toBe(p1.id);
    const synonym = await api(
      'get',
      `shop/products?q=face%20wash%20${run}&availableOnly=true`,
    ).expect(200);
    expect(synonym.body.items.map((i: { id: string }) => i.id)).toEqual([
      p2.id,
    ]); // "face wash" also means cleanser
    expect(synonym.body.relaxed).toBeUndefined();
    const cat = await api(
      'get',
      `shop/products?category=skin-care&availableOnly=true&q=${run}`,
    ).expect(200);
    expect(cat.body.items.map((i: { id: string }) => i.id)).toEqual([p2.id]);
    const cheap = await api(
      'get',
      `shop/products?q=${run}&maxPrice=300`,
    ).expect(200);
    expect(cheap.body.items.map((i: { id: string }) => i.id)).toEqual([p2.id]);
    const sorted = await api(
      'get',
      `shop/products?q=${run}&sort=price_desc`,
    ).expect(200);
    expect(sorted.body.items.map((i: { id: string }) => i.id)).toEqual([
      p1.id,
      p2.id,
    ]);
    const offers = await api(
      'get',
      `shop/products?q=${run}&onSale=true`,
    ).expect(200);
    expect(offers.body.items.map((i: { id: string }) => i.id)).toEqual([p1.id]);
  });

  it('cart quote is server-priced and enforces one salon per order', async () => {
    const mixed = await api('post', 'shop/cart/quote')
      .send({
        items: [
          { listingId: a1.listingId, quantity: 1 },
          { listingId: b1.listingId, quantity: 1 },
        ],
      })
      .expect(200);
    expect(mixed.body.blocking.join(' ')).toMatch(/more than one salon/);
    const ok = await api('post', 'shop/cart/quote')
      .send({
        items: [
          { listingId: a1.listingId, quantity: 2 },
          { listingId: a2.listingId, quantity: 1 },
        ],
      })
      .expect(200);
    expect(ok.body).toMatchObject({
      subtotal: '1299.00',
      total: '1299.00',
      savings: '100.00',
      blocking: [],
    });
    const tooMany = await api('post', 'shop/cart/quote')
      .send({ items: [{ listingId: a1.listingId, quantity: 4 }] })
      .expect(200);
    expect(tooMany.body.blocking.join(' ')).toMatch(/Only 3 left/);
  });

  it('guest checkout: price changes are refused, a retried submit never duplicates, the guest link works', async () => {
    await checkout([{ listingId: a2.listingId, quantity: 1 }], '150.00').expect(
      409,
    );
    const key = randomUUID();
    const first = await checkout(
      [{ listingId: a2.listingId, quantity: 1 }],
      '199.00',
      key,
    ).expect(201);
    const again = await checkout(
      [{ listingId: a2.listingId, quantity: 1 }],
      '199.00',
      key,
    ).expect(200);
    expect(again.body.order.id).toBe(first.body.order.id);
    expect(
      await prisma.shopOrder.count({
        where: { idempotencyKey: `shop:${key}` },
      }),
    ).toBe(1);
    const { orderNumber } = first.body.order;
    expect(first.body.order).toMatchObject({
      status: 'PLACED',
      paymentStatus: 'UNPAID',
      total: '199.00',
      salon: { id: ids.A },
    });
    await api(
      'get',
      `shop/orders/${orderNumber}?token=${first.body.accessToken}`,
    ).expect(200);
    await api(
      'get',
      `shop/orders/${orderNumber}?token=${'x'.repeat(43)}`,
    ).expect(404);
    // The guest cancels: stock is released (it was reserved, never deducted).
    await api(
      'post',
      `shop/orders/${orderNumber}/cancel?token=${first.body.accessToken}`,
    )
      .send({})
      .expect(200);
    const q = await api('post', 'shop/cart/quote')
      .send({ items: [{ listingId: a2.listingId, quantity: 4 }] })
      .expect(200);
    expect(q.body.blocking).toEqual([]);
  });

  it('concurrent checkouts can never oversell the last units', async () => {
    const race = await Promise.all(
      Array.from({ length: 6 }, () =>
        checkout([{ listingId: a1.listingId, quantity: 1 }], '550.00'),
      ),
    );
    const created = race.filter((r) => r.status === 201).length;
    expect(created).toBe(3);
    expect(
      race.filter((r) => r.status !== 201).every((r) => r.status === 409),
    ).toBe(true);
    const detail = await api('get', `shop/products/${p1.id}`).expect(200);
    expect(
      detail.body.offers.find(
        (o: { salon: { id: string } }) => o.salon.id === ids.A,
      ),
    ).toMatchObject({ availableQuantity: 0, availability: 'OUT_OF_STOCK' });
    // Stock on hand is untouched until collection — only reserved.
    expect(
      (
        await prisma.inventoryProduct.findUniqueOrThrow({
          where: { id: a1.inventoryProductId },
        })
      ).stockOnHand.toFixed(3),
    ).toBe('3.000');
  });

  it('seller lifecycle: only allowed transitions; collection takes stock off through the ledger; other salons are isolated', async () => {
    const orders = await api(
      'get',
      `${owner('A')}/shop/orders?status=PLACED`,
      tok.A,
    ).expect(200);
    const order = orders.body.items.find(
      (o: { items: Array<{ productId: string }> }) =>
        o.items[0].productId === p1.id,
    );
    const path = `${owner('A')}/shop/orders/${order.id}/transition`;
    await api('post', `${owner('B')}/shop/orders/${order.id}/transition`, tok.B)
      .send({ to: 'ACCEPTED' })
      .expect(404);
    await api('post', path, tok.B).send({ to: 'ACCEPTED' }).expect(403);
    await api('post', path, tok.A)
      .send({ to: 'COMPLETED', paidAtSalon: true })
      .expect(409); // skipping steps
    await api('post', path, tok.A).send({ to: 'ACCEPTED' }).expect(200);
    await api('post', path, tok.A).send({ to: 'ACCEPTED' }).expect(200); // retry is a no-op
    await api('post', path, tok.A).send({ to: 'READY_FOR_PICKUP' }).expect(200);
    await api('post', path, tok.A).send({ to: 'COMPLETED' }).expect(400); // must confirm payment at the salon
    const done = await api('post', path, tok.A)
      .send({ to: 'COMPLETED', paidAtSalon: true })
      .expect(200);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      paymentStatus: 'PAID_AT_SALON',
      allowedTransitions: [],
    });
    expect(
      (
        await prisma.inventoryProduct.findUniqueOrThrow({
          where: { id: a1.inventoryProductId },
        })
      ).stockOnHand.toFixed(3),
    ).toBe('2.000');
    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { productId: a1.inventoryProductId, kind: 'ADJUSTMENT' },
    });
    expect(movement.reason).toContain(done.body.orderNumber);
    expect(movement.quantityDelta.toFixed(3)).toBe('-1.000');
    // A cancelled order frees its unit again; an expired one too.
    const other = orders.body.items.filter(
      (o: { id: string; items: Array<{ productId: string }> }) =>
        o.id !== order.id && o.items[0].productId === p1.id,
    );
    await api(
      'post',
      `${owner('A')}/shop/orders/${other[0].id}/transition`,
      tok.A,
    )
      .send({ to: 'CANCELLED', note: 'Out of stock' })
      .expect(200);
    await prisma.shopOrder.update({
      where: { id: other[1].id },
      data: { acceptBy: new Date(Date.now() - 1000) },
    });
    expect(
      await app.get(ShopOrderService).expireStale(),
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await prisma.shopOrder.findUniqueOrThrow({ where: { id: other[1].id } }))
        .status,
    ).toBe('EXPIRED');
    const detail = await api('get', `shop/products/${p1.id}`).expect(200);
    expect(
      detail.body.offers.find(
        (o: { salon: { id: string } }) => o.salon.id === ids.A,
      ).availableQuantity,
    ).toBe(2);
  });

  it('signed-in customer checkout lands on the account; analytics apply the commission', async () => {
    const r = await checkout(
      [{ listingId: b1.listingId, quantity: 2 }],
      '1050.00',
      randomUUID(),
      tok.customer,
    ).expect(201);
    const mine = await api('get', 'customer/shop/orders', tok.customer).expect(
      200,
    );
    expect(
      mine.body.map((o: { orderNumber: string }) => o.orderNumber),
    ).toContain(r.body.order.orderNumber);
    await api(
      'get',
      `customer/shop/orders/${r.body.order.orderNumber}`,
      tok.A,
    ).expect(403);
    const sales = await api(
      'get',
      `${owner('A')}/shop/analytics?period=day`,
      tok.A,
    ).expect(200);
    expect(sales.body).toMatchObject({
      completedOrders: 1,
      unitsSold: 1,
      grossSales: '550.00',
      commissionPercent: '10.00',
      commission: '55.00',
      netProceeds: '495.00',
    });
    await api('get', `${owner('A')}/shop/analytics`, tok.B).expect(403);
    const stats = await api('get', 'admin/shop/stats', tok.admin).expect(200);
    expect(stats.body.listings.APPROVED).toBeGreaterThanOrEqual(3);
    await api('put', `customer/shop/wishlist/${p1.id}`, tok.customer).expect(
      204,
    );
    expect(
      (await api('get', 'customer/shop/wishlist', tok.customer).expect(200))
        .body,
    ).toContain(p1.id);
  });
});
