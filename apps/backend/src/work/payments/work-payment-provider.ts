import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { HttpStatus } from '@nestjs/common';
import { WorkErrorCode } from '@barbercue/shared';
import { workError } from '../work-errors';

export const WORK_PAYMENT_PROVIDER = Symbol('WORK_PAYMENT_PROVIDER');

export type WorkProviderEventType =
  'funding.succeeded' | 'funding.failed' | 'payout.succeeded' | 'payout.failed';

export interface WorkProviderEvent {
  eventId: string;
  type: WorkProviderEventType;
  /** providerOrderId for funding events, providerPayoutId for payout events. */
  reference: string;
  amountPaise: number;
  failureReason?: string;
  /** Unix seconds when the provider created the event. */
  createdAt: number;
}

/**
 * The only boundary between marketplace logic and a payment partner. Business code calls these
 * methods and processes signed webhooks; it never decides on its own that money moved. A real
 * RBI-authorised partner (payment collection + payouts) is added by writing one more adapter.
 */
export interface WorkPaymentProvider {
  readonly name: string;
  readonly sandbox: boolean;
  createFundingOrder(input: {
    fundingId: string;
    amountPaise: number;
    idempotencyKey: string;
  }): Promise<{ providerOrderId: string }>;
  createPayout(input: {
    payoutId: string;
    amountPaise: number;
    upiVpa: string;
    idempotencyKey: string;
  }): Promise<{ providerPayoutId: string }>;
  /** Verifies the signature and freshness, then returns the parsed event. Throws on anything invalid. */
  verifyAndParseWebhook(
    headers: Record<string, string | undefined>,
    body: unknown,
  ): WorkProviderEvent;
}

const notConfigured = () =>
  workError(
    WorkErrorCode.PAYMENTS_NOT_CONFIGURED,
    'Online payments for FastQue Work are not set up yet, so this job cannot be funded.',
    HttpStatus.SERVICE_UNAVAILABLE,
  );

/** Default: no provider. Funding and payouts fail closed; nothing is ever reported as paid. */
export class UnconfiguredWorkPaymentProvider implements WorkPaymentProvider {
  readonly name = 'none';
  readonly sandbox = false;
  createFundingOrder(): Promise<{ providerOrderId: string }> {
    return Promise.reject(notConfigured());
  }
  createPayout(): Promise<{ providerPayoutId: string }> {
    return Promise.reject(notConfigured());
  }
  verifyAndParseWebhook(): WorkProviderEvent {
    throw workError(
      WorkErrorCode.WEBHOOK_SIGNATURE_INVALID,
      'Webhook rejected.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}

export const SANDBOX_SIGNATURE_HEADER = 'x-work-signature';
export const SANDBOX_TIMESTAMP_HEADER = 'x-work-timestamp';
const SANDBOX_MAX_AGE_SECONDS = 300;

export function sandboxSigningPayload(e: WorkProviderEvent): string {
  return [
    e.createdAt,
    e.eventId,
    e.type,
    e.reference,
    e.amountPaise,
    e.failureReason ?? '',
  ].join('.');
}

/**
 * SANDBOX — moves no money. Used only outside production (see configuredWorkPaymentProvider).
 * It behaves like a real partner where it matters for correctness: orders and payouts get
 * provider references, outcomes arrive only as HMAC-signed webhooks with a timestamp, stale
 * timestamps are rejected, and every event carries a unique id for replay protection.
 * The sandbox controller is the only thing that produces those events.
 */
export class SandboxWorkPaymentProvider implements WorkPaymentProvider {
  readonly name = 'sandbox';
  readonly sandbox = true;

  constructor(private readonly secret: string) {
    if (!secret || secret.length < 16) {
      throw new Error(
        'WORK_SANDBOX_WEBHOOK_SECRET must be at least 16 characters',
      );
    }
  }

  createFundingOrder(input: {
    fundingId: string;
  }): Promise<{ providerOrderId: string }> {
    return Promise.resolve({ providerOrderId: `sbx_order_${input.fundingId}` });
  }

  createPayout(input: {
    payoutId: string;
  }): Promise<{ providerPayoutId: string }> {
    return Promise.resolve({
      providerPayoutId: `sbx_payout_${input.payoutId}`,
    });
  }

  sign(e: WorkProviderEvent): string {
    return createHmac('sha256', this.secret)
      .update(sandboxSigningPayload(e))
      .digest('hex');
  }

  /** Builds a signed event exactly as the sandbox "bank" would send it. */
  buildEvent(
    type: WorkProviderEventType,
    reference: string,
    amountPaise: number,
    failureReason?: string,
  ) {
    const event: WorkProviderEvent = {
      eventId: `sbx_evt_${randomUUID()}`,
      type,
      reference,
      amountPaise,
      failureReason,
      createdAt: Math.floor(Date.now() / 1000),
    };
    return {
      event,
      headers: {
        [SANDBOX_SIGNATURE_HEADER]: this.sign(event),
        [SANDBOX_TIMESTAMP_HEADER]: String(event.createdAt),
      },
    };
  }

  verifyAndParseWebhook(
    headers: Record<string, string | undefined>,
    body: unknown,
  ): WorkProviderEvent {
    const reject = () =>
      workError(
        WorkErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Webhook rejected.',
        HttpStatus.UNAUTHORIZED,
      );
    const signature = headers[SANDBOX_SIGNATURE_HEADER];
    const timestamp = Number(headers[SANDBOX_TIMESTAMP_HEADER]);
    if (
      !signature ||
      !/^[0-9a-f]{64}$/.test(signature) ||
      !Number.isInteger(timestamp)
    )
      throw reject();
    const b = (body ?? {}) as Partial<WorkProviderEvent>;
    const types: WorkProviderEventType[] = [
      'funding.succeeded',
      'funding.failed',
      'payout.succeeded',
      'payout.failed',
    ];
    if (
      typeof b.eventId !== 'string' ||
      typeof b.reference !== 'string' ||
      !types.includes(b.type as WorkProviderEventType) ||
      !Number.isInteger(b.amountPaise) ||
      b.createdAt !== timestamp
    ) {
      throw reject();
    }
    const event: WorkProviderEvent = {
      eventId: b.eventId,
      type: b.type as WorkProviderEventType,
      reference: b.reference,
      amountPaise: b.amountPaise as number,
      failureReason:
        typeof b.failureReason === 'string'
          ? b.failureReason.slice(0, 200)
          : undefined,
      createdAt: timestamp,
    };
    const expected = Buffer.from(this.sign(event), 'hex');
    const given = Buffer.from(signature, 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw reject();
    const age = Math.floor(Date.now() / 1000) - timestamp;
    if (age > SANDBOX_MAX_AGE_SECONDS || age < -60) throw reject();
    return event;
  }
}
