import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Prisma } from '@prisma/client';
import {
  Role,
  SalonStatus,
  SessionAudience,
  UserStatus,
} from '@barbercue/shared';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';
import { TokenService } from '../src/auth/services/token.service';

process.env.JWT_ACCESS_SECRET ??=
  'inventory-e2e-only-jwt-secret-not-production';
process.env.TOTP_ENCRYPTION_KEY ??=
  'inventory-e2e-only-encryption-secret-not-production';

const DATABASE_URL = process.env.DATABASE_URL ?? '';
let isDisposableInventoryDatabase = false;
try {
  const parsed = new URL(DATABASE_URL);
  const dbName = decodeURIComponent(
    parsed.pathname.replace(/^\//, '').split('/')[0] ?? '',
  );
  isDisposableInventoryDatabase =
    ['127.0.0.1', 'localhost'].includes(parsed.hostname) &&
    ['owner_ops_chain', 'inventory_certification'].includes(dbName);
} catch {
  isDisposableInventoryDatabase = false;
}
const maybe = isDisposableInventoryDatabase ? describe : describe.skip;

/**
 * Authenticated inventory acceptance against the real AppModule and disposable PostgreSQL only.
 * This suite is intentionally skipped unless DATABASE_URL is loopback and names the dedicated CI
 * certification database; it never cleans immutable movements because the whole CI database is
 * ephemeral and discarded with the runner.
 */
maybe('Inventory API (authenticated disposable PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let tokens: TokenService;
  const run = randomUUID().slice(0, 8);
  const ids: Record<string, string> = {};
  const accessTokens: Record<string, string> = {};

  const api = (
    method: 'get' | 'post' | 'patch',
    path: string,
    token?: string,
    key?: string,
  ) => {
    const req = request(app.getHttpServer())[method](`/api/v1/${path}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req;
  };

  async function makeUser(label: string, role: Role, salonId: string) {
    const user = await prisma.user.create({
      data: {
        email: `inventory-${run}-${label}@example.test`,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, role, salonId } });
    accessTokens[label] = tokens.signAccessToken(
      user.id,
      [role],
      SessionAudience.STAFF,
    );
    ids[label] = user.id;
    return user;
  }

  const root = (salonLabel: string) =>
    `dashboard/salons/${ids[salonLabel]}/inventory`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(TokenService);

    const city = await prisma.city.findFirstOrThrow({
      where: { slug: 'jharsuguda' },
    });
    for (const label of ['salonA', 'salonB'] as const) {
      const owner = await prisma.user.create({
        data: {
          email: `inventory-${run}-${label}-owner@example.test`,
          status: UserStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      });
      const salon = await prisma.salon.create({
        data: {
          ownerUserId: owner.id,
          name: `Inventory ${label} ${run}`,
          slug: `inventory-${label}-${run}`,
          cityId: city.id,
          addressLine: 'Disposable certification address',
          status: SalonStatus.ACTIVE,
          timezone: 'Asia/Kolkata',
          currency: 'INR',
        },
      });
      await prisma.userRole.create({
        data: { userId: owner.id, role: Role.SALON_OWNER, salonId: salon.id },
      });
      ids[label] = salon.id;
      ids[`${label}Owner`] = owner.id;
      accessTokens[label === 'salonA' ? 'ownerA' : 'ownerB'] =
        tokens.signAccessToken(
          owner.id,
          [Role.SALON_OWNER],
          SessionAudience.STAFF,
        );
    }
    const staff = await makeUser('staff', Role.SALON_STAFF, ids.salonA);
    void staff;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('isolates salon access, applies audited idempotent movements, reports value, and prevents concurrent negative stock', async () => {
    const a = root('salonA');
    const b = root('salonB');
    await api('get', `${a}/categories`).expect(401);
    await api('get', `${a}/categories`, accessTokens.staff).expect(403);

    const [financialPaymentsBefore, customerLedgerBefore] = await Promise.all([
      prisma.invoicePayment.count({ where: { salonId: ids.salonA } }),
      prisma.customerLedgerEntry.count({ where: { salonId: ids.salonA } }),
    ]);

    const category = await api('post', `${a}/categories`, accessTokens.ownerA)
      .send({ name: 'Hair care' })
      .expect(201);
    const categoryPage = await api(
      'get',
      `${a}/categories?limit=1`,
      accessTokens.ownerA,
    ).expect(200);
    expect(categoryPage.body).toMatchObject({
      hasMore: false,
      items: [{ id: category.body.id }],
    });
    await api('post', `${a}/categories`, accessTokens.ownerA)
      .send({ name: '  hair CARE  ' })
      .expect(409);
    const foreignCategory = await api(
      'post',
      `${b}/categories`,
      accessTokens.ownerB,
    )
      .send({ name: 'Other category' })
      .expect(201);
    await expect(
      prisma.inventoryProduct.create({
        data: {
          salonId: ids.salonA,
          name: 'Invalid cross-salon product',
          normalizedName: 'invalid cross-salon product',
          unit: 'EACH',
          categoryId: foreignCategory.body.id as string,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });

    const supplier = await api('post', `${a}/suppliers`, accessTokens.ownerA)
      .send({
        name: `Local Supply ${run}`,
        contactName: 'Test Contact',
        email: 'supplier@example.test',
      })
      .expect(201);
    const supplierPage = await api(
      'get',
      `${a}/suppliers?limit=1`,
      accessTokens.ownerA,
    ).expect(200);
    expect(supplierPage.body).toMatchObject({
      hasMore: false,
      items: [{ id: supplier.body.id }],
    });
    const created = await api('post', `${a}/products`, accessTokens.ownerA)
      .send({
        name: 'Salon shampoo',
        sku: `sh-${run}`,
        unit: 'EACH',
        categoryId: category.body.id,
        supplierId: supplier.body.id,
        reorderThreshold: 2,
      })
      .expect(201);
    const productId = created.body.id as string;
    expect(created.body.stockOnHand).toBe('0.000');
    expect(created.body.isLowStock).toBe(true);
    await expect(
      prisma.inventoryProduct.create({
        data: {
          salonId: ids.salonA,
          name: 'Direct balance insert must fail',
          normalizedName: 'direct balance insert must fail',
          unit: 'EACH',
          stockOnHand: new Prisma.Decimal('1.000'),
          averageUnitCost: new Prisma.Decimal('10.00'),
        },
      }),
    ).rejects.toThrow(/must start with zero stock/i);

    // A client cannot use an existing salon's category in another salon's product.
    await api('post', `${a}/products`, accessTokens.ownerA)
      .send({
        name: 'Cross salon attempt',
        unit: 'EACH',
        categoryId: foreignCategory.body.id,
      })
      .expect(404);
    // Another salon's owner cannot address a product by changing only the route's salon id.
    await api(
      'post',
      `${b}/products/${productId}/movements`,
      accessTokens.ownerB,
      randomUUID(),
    )
      .send({
        kind: 'OPENING',
        quantity: 1,
        unitCost: 1,
      })
      .expect(404);

    const openingKey = randomUUID();
    const opening = await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      openingKey,
    )
      .send({
        kind: 'OPENING',
        quantity: 5,
        unitCost: 100,
      })
      .expect(201);
    expect(opening.body.movement).toMatchObject({
      kind: 'OPENING',
      quantityDelta: '5.000',
      stockAfter: '5.000',
      averageUnitCostAfter: '100.00',
    });
    const openingReplay = await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      openingKey,
    )
      .send({
        kind: 'OPENING',
        quantity: 5,
        unitCost: 100,
      })
      .expect(200);
    expect(openingReplay.body.movement.id).toBe(opening.body.movement.id);
    await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      openingKey,
    )
      .send({
        kind: 'OPENING',
        quantity: 4,
        unitCost: 100,
      })
      .expect(409);
    await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      randomUUID(),
    )
      .send({
        kind: 'OPENING',
        quantity: 1,
        unitCost: 100,
      })
      .expect(409);

    const purchaseKey = randomUUID();
    const purchaseInput = {
      kind: 'PURCHASE',
      quantity: 5,
      unitCost: 200,
      supplierId: supplier.body.id,
      reference: 'PO-test',
    };
    const purchase = await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      purchaseKey,
    )
      .send(purchaseInput)
      .expect(201);
    const purchaseReplay = await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      purchaseKey,
    )
      .send(purchaseInput)
      .expect(200);
    expect(purchaseReplay.body.movement.id).toBe(purchase.body.movement.id);
    expect(purchase.body.movement).toMatchObject({
      quantityDelta: '5.000',
      stockAfter: '10.000',
      averageUnitCostAfter: '150.00',
      supplier: { id: supplier.body.id },
    });

    const consumed = await api(
      'post',
      `${a}/products/${productId}/movements`,
      accessTokens.ownerA,
      randomUUID(),
    )
      .send({
        kind: 'CONSUMPTION',
        quantity: 2,
        reason: 'Used during service',
      })
      .expect(201);
    expect(consumed.body.movement).toMatchObject({
      quantityDelta: '-2.000',
      stockAfter: '8.000',
      averageUnitCostAfter: '150.00',
    });
    const updated = await api(
      'patch',
      `${a}/products/${productId}`,
      accessTokens.ownerA,
    )
      .send({ reorderThreshold: 8, isActive: true })
      .expect(200);
    expect(updated.body.isLowStock).toBe(true);

    const raceProduct = await api('post', `${a}/products`, accessTokens.ownerA)
      .send({
        name: 'Race-test product',
        unit: 'EACH',
        sku: `race-${run}`,
      })
      .expect(201);
    const raceId = raceProduct.body.id as string;
    await api(
      'post',
      `${a}/products/${raceId}/movements`,
      accessTokens.ownerA,
      randomUUID(),
    )
      .send({
        kind: 'OPENING',
        quantity: 5,
        unitCost: 10,
      })
      .expect(201);
    const race = await Promise.all(
      [1, 2].map(() =>
        api(
          'post',
          `${a}/products/${raceId}/movements`,
          accessTokens.ownerA,
          randomUUID(),
        ).send({
          kind: 'CONSUMPTION',
          quantity: 4,
        }),
      ),
    );
    expect(race.map((response) => response.status).sort()).toEqual([201, 409]);
    const raceState = await prisma.inventoryProduct.findFirstOrThrow({
      where: { id: raceId, salonId: ids.salonA },
    });
    expect(raceState.stockOnHand.toFixed(3)).toBe('1.000');
    expect(
      await prisma.inventoryMovement.count({
        where: { salonId: ids.salonA, productId: raceId },
      }),
    ).toBe(2);

    const report = await api('get', `${a}/report`, accessTokens.ownerA).expect(
      200,
    );
    expect(report.body).toMatchObject({
      productCount: 2,
      lowStockCount: 1,
      estimatedStockValue: '1210.00',
      valuationBasis: 'weighted-average-cost',
      currency: 'INR',
      movementCounts: {
        OPENING: 2,
        PURCHASE: 1,
        CONSUMPTION: 2,
        ADJUSTMENT: 0,
      },
    });
    const movements = await api(
      'get',
      `${a}/movements?productId=${productId}&limit=2`,
      accessTokens.ownerA,
    ).expect(200);
    expect(movements.body).toMatchObject({ hasMore: true });
    expect(movements.body.items).toHaveLength(2);
    expect(typeof movements.body.nextCursor).toBe('string');
    const nextMovements = await api(
      'get',
      `${a}/movements?productId=${productId}&limit=2&cursor=${encodeURIComponent(movements.body.nextCursor)}`,
      accessTokens.ownerA,
    ).expect(200);
    expect(nextMovements.body).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
    expect(nextMovements.body.items).toHaveLength(1);
    expect(nextMovements.body.items[0].id).not.toBe(movements.body.items[0].id);
    await api(
      'get',
      `${a}/movements?productId=${raceId}&limit=2&cursor=${encodeURIComponent(movements.body.nextCursor)}`,
      accessTokens.ownerA,
    ).expect(400);

    await expect(
      prisma.$executeRaw`UPDATE "inventory_products" SET "stockOnHand" = 999 WHERE "id" = ${productId}`,
    ).rejects.toThrow(/inventory stock and valuation/i);
    await expect(
      prisma.$executeRaw`UPDATE "inventory_movements" SET "reason" = 'tamper' WHERE "id" = ${opening.body.movement.id}`,
    ).rejects.toThrow(/append-only/i);
    await expect(
      prisma.$executeRaw`DELETE FROM "inventory_movements" WHERE "id" = ${opening.body.movement.id}`,
    ).rejects.toThrow(/append-only/i);

    const [financialPaymentsAfter, customerLedgerAfter, auditedMovements] =
      await Promise.all([
        prisma.invoicePayment.count({ where: { salonId: ids.salonA } }),
        prisma.customerLedgerEntry.count({ where: { salonId: ids.salonA } }),
        prisma.auditLog.count({
          where: {
            entityType: 'InventoryMovement',
            entityId: {
              in: [
                opening.body.movement.id,
                purchase.body.movement.id,
                consumed.body.movement.id,
              ],
            },
          },
        }),
      ]);
    expect(financialPaymentsAfter).toBe(financialPaymentsBefore);
    expect(customerLedgerAfter).toBe(customerLedgerBefore);
    expect(auditedMovements).toBe(3); // Every movement listed above has an atomic audit row.
  });
});
