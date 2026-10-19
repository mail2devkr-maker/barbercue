import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import {
  BookingErrorCode,
  type OwnerCustomerDirectoryQuery,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';

export interface CustomerDirectoryCursor {
  v: 1;
  actorId: string;
  salonId: string;
  filterKey: string;
  sort: OwnerCustomerDirectoryQuery['sort'];
  sortValue: string | null;
  customerId: string;
}

export interface CustomerServicesCursor {
  v: 1;
  actorId: string;
  salonId: string;
  customerId: string;
  completedAt: string;
  sourceRank: 0 | 1 | 2;
  visitId: string;
  serviceOrder: number;
  serviceId: string;
}

function signingKey(): Buffer {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret || secret.length < 32) {
    throw new AppException(
      BookingErrorCode.CUSTOMER_DIRECTORY_CURSOR_UNAVAILABLE,
      'Customer directory pagination is temporarily unavailable.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  return createHmac('sha256', secret)
    .update('fastque:customer-crm-cursor-signing-key:v1')
    .digest();
}

function filterKey(
  actorId: string,
  query: OwnerCustomerDirectoryQuery,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        actorId,
        q: query.q?.trim().toLocaleLowerCase('en-US') ?? null,
        segment: query.segment ?? null,
        sort: query.sort,
        minVisits: query.minVisits,
      }),
    )
    .digest('hex');
}

function encode(value: object, domain: string): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf8').toString(
    'base64url',
  );
  const signature = createHmac('sha256', signingKey())
    .update(domain)
    .update('\0')
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function decode<T>(raw: string, domain: string): T | null {
  const key = signingKey();
  try {
    const [payload, supplied, extra] = raw.split('.');
    if (!payload || !supplied || extra !== undefined) return null;
    const expected = createHmac('sha256', key)
      .update(domain)
      .update('\0')
      .update(payload)
      .digest();
    const received = Buffer.from(supplied, 'base64url');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      return null;
    }
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

export function encodeCustomerDirectoryCursor(
  actorId: string,
  salonId: string,
  query: OwnerCustomerDirectoryQuery,
  sortValue: string | null,
  customerId: string,
): string {
  const cursor: CustomerDirectoryCursor = {
    v: 1,
    actorId,
    salonId,
    filterKey: filterKey(actorId, query),
    sort: query.sort,
    sortValue,
    customerId,
  };
  return encode(cursor, 'fastque:customer-directory-cursor:v1');
}

export function decodeCustomerDirectoryCursor(
  raw: string | undefined,
  actorId: string,
  salonId: string,
  query: OwnerCustomerDirectoryQuery,
): CustomerDirectoryCursor | null {
  if (!raw) return null;
  const cursor = decode<CustomerDirectoryCursor>(
    raw,
    'fastque:customer-directory-cursor:v1',
  );
  if (
    !cursor ||
    cursor.v !== 1 ||
    cursor.actorId !== actorId ||
    cursor.salonId !== salonId ||
    cursor.filterKey !== filterKey(actorId, query) ||
    cursor.sort !== query.sort ||
    typeof cursor.customerId !== 'string' ||
    cursor.customerId.length < 1 ||
    cursor.customerId.length > 128 ||
    (cursor.sortValue !== null && typeof cursor.sortValue !== 'string')
  ) {
    return null;
  }
  if (cursor.sort === 'lastVisit') {
    if (
      cursor.sortValue !== null &&
      !Number.isFinite(Date.parse(cursor.sortValue))
    )
      return null;
  } else if (
    cursor.sortValue === null ||
    !/^-?\d{1,20}$/.test(cursor.sortValue)
  ) {
    return null;
  }
  return cursor;
}

export function encodeCustomerServicesCursor(
  cursor: Omit<CustomerServicesCursor, 'v'>,
): string {
  return encode({ v: 1, ...cursor }, 'fastque:customer-services-cursor:v1');
}

export function decodeCustomerServicesCursor(
  raw: string | undefined,
  actorId: string,
  salonId: string,
  customerId: string,
): CustomerServicesCursor | null {
  if (!raw) return null;
  const cursor = decode<CustomerServicesCursor>(
    raw,
    'fastque:customer-services-cursor:v1',
  );
  if (
    !cursor ||
    cursor.v !== 1 ||
    cursor.actorId !== actorId ||
    cursor.salonId !== salonId ||
    cursor.customerId !== customerId ||
    !Number.isFinite(Date.parse(cursor.completedAt)) ||
    (cursor.sourceRank !== 0 &&
      cursor.sourceRank !== 1 &&
      cursor.sourceRank !== 2) ||
    typeof cursor.visitId !== 'string' ||
    cursor.visitId.length < 1 ||
    cursor.visitId.length > 128 ||
    !Number.isInteger(cursor.serviceOrder) ||
    cursor.serviceOrder < 0 ||
    typeof cursor.serviceId !== 'string' ||
    cursor.serviceId.length < 1 ||
    cursor.serviceId.length > 128
  ) {
    return null;
  }
  return cursor;
}

export function invalidCustomerCursor(): AppException {
  return new AppException(
    BookingErrorCode.INVALID_FILTER,
    'The customer cursor is invalid or belongs to another query.',
    HttpStatus.BAD_REQUEST,
  );
}
