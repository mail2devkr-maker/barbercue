import { createHash } from 'crypto';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { type Observable, of, throwError } from 'rxjs';
import { BookingErrorCode } from '@barbercue/shared';
import { IdempotencyInterceptor } from './idempotency.interceptor';

interface MockRequest {
  method: string;
  originalUrl: string;
  body: unknown;
  header: (name: string) => string | undefined;
}

function makeContext(request: MockRequest): ExecutionContext {
  return {
    getHandler: () => ({}) as unknown,
    getClass: () => ({}) as unknown,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeRequest(): MockRequest {
  return {
    method: 'POST',
    originalUrl: '/api/v1/bookings',
    body: { salonId: 's1' },
    header: (name: string) =>
      name.toLowerCase() === 'idempotency-key' ? 'key-1' : undefined,
  };
}

function makeHandler(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable };
}

interface PrismaMock {
  idempotencyKey: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
    findUnique: jest.Mock<Promise<unknown>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
    delete: jest.Mock<Promise<unknown>, [unknown]>;
  };
}

function makePrismaMock(): PrismaMock {
  return {
    idempotencyKey: {
      create: jest.fn<Promise<unknown>, [unknown]>(),
      findUnique: jest.fn<Promise<unknown>, [unknown]>(),
      update: jest.fn<Promise<unknown>, [unknown]>(),
      delete: jest.fn<Promise<unknown>, [unknown]>(),
    },
  };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.19.1',
  });
}

describe('IdempotencyInterceptor', () => {
  it('passes through untouched when the route has no @Idempotent() metadata', async () => {
    const reflector = {
      getAllAndOverride: () => undefined,
    } as unknown as Reflector;
    const prisma = makePrismaMock();
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ ok: true }));

    const result = interceptor.intercept(makeContext(makeRequest()), handler);
    expect(await new Promise((resolve) => result.subscribe(resolve))).toEqual({
      ok: true,
    });
    expect(prisma.idempotencyKey.create).not.toHaveBeenCalled();
  });

  it('rejects a decorated route missing the Idempotency-Key header', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ ok: true }));
    const request = makeRequest();
    request.header = () => undefined;

    const result = interceptor.intercept(makeContext(request), handler);
    await expect(
      new Promise((_resolve, reject) => result.subscribe({ error: reject })),
    ).rejects.toMatchObject({
      code: BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
    });
  });

  it('claims the key, runs the handler once, and persists the response snapshot', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.update.mockResolvedValue({});
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ bookingId: 'b1' }));

    const result = interceptor.intercept(makeContext(makeRequest()), handler);
    const value = await new Promise((resolve) => result.subscribe(resolve));

    expect(value).toEqual({ bookingId: 'b1' });
    expect(prisma.idempotencyKey.create).toHaveBeenCalledTimes(1);
    expect(prisma.idempotencyKey.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'key-1' },
        data: { responseSnapshot: { bookingId: 'b1' } },
      }),
    );
  });

  it('releases the claim and rethrows when the handler fails', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    prisma.idempotencyKey.create.mockResolvedValue({});
    prisma.idempotencyKey.delete.mockResolvedValue({});
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(throwError(() => new Error('boom')));

    const result = interceptor.intercept(makeContext(makeRequest()), handler);
    await expect(
      new Promise((_resolve, reject) => result.subscribe({ error: reject })),
    ).rejects.toThrow('boom');
    expect(prisma.idempotencyKey.delete).toHaveBeenCalledWith({
      where: { key: 'key-1' },
    });
  });

  it('replays the cached response for a same-key same-body retry', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    const request = makeRequest();
    const requestHash = createHash('sha256')
      .update(
        `${request.method}:${request.originalUrl}:${JSON.stringify(request.body)}`,
      )
      .digest('hex');
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'key-1',
      requestHash,
      responseSnapshot: { bookingId: 'b1' },
    });
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ shouldNotBeUsed: true }));

    const result = interceptor.intercept(makeContext(request), handler);
    const value = await new Promise((resolve) => result.subscribe(resolve));
    expect(value).toEqual({ bookingId: 'b1' });
  });

  it('rejects reuse of the same key for a different request body', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'key-1',
      requestHash: 'a-different-hash',
      responseSnapshot: { bookingId: 'b1' },
    });
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ ok: true }));

    const result = interceptor.intercept(makeContext(makeRequest()), handler);
    await expect(
      new Promise((_resolve, reject) => result.subscribe({ error: reject })),
    ).rejects.toMatchObject({
      code: BookingErrorCode.IDEMPOTENCY_KEY_REUSED,
    });
  });

  it('rejects a concurrent in-flight duplicate (claim exists, no snapshot yet)', async () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const prisma = makePrismaMock();
    prisma.idempotencyKey.create.mockRejectedValue(p2002());
    const request = makeRequest();
    const requestHash = createHash('sha256')
      .update(
        `${request.method}:${request.originalUrl}:${JSON.stringify(request.body)}`,
      )
      .digest('hex');
    prisma.idempotencyKey.findUnique.mockResolvedValue({
      key: 'key-1',
      requestHash,
      responseSnapshot: null,
    });
    const interceptor = new IdempotencyInterceptor(reflector, prisma as never);
    const handler = makeHandler(of({ ok: true }));

    const result = interceptor.intercept(makeContext(request), handler);
    await expect(
      new Promise((_resolve, reject) => result.subscribe({ error: reject })),
    ).rejects.toMatchObject({
      code: BookingErrorCode.REQUEST_IN_PROGRESS,
    });
  });
});
