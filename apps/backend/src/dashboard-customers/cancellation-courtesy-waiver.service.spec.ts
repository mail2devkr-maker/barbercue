import { Test } from '@nestjs/testing';
import {
  CANCELLATION_COURTESY_WAIVER_LIMIT,
  LedgerReason,
  LedgerStatus,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { CancellationCourtesyWaiverService } from './cancellation-courtesy-waiver.service';

function ledgerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ledger-1',
    customerId: 'customer-1',
    salonId: 'salon-1',
    bookingId: 'booking-1',
    amount: 25,
    reason: LedgerReason.CANCELLATION_CHARGE,
    status: LedgerStatus.OUTSTANDING,
    createdAt: new Date('2026-09-03T10:00:00.000Z'),
    settledAt: null,
    booking: {
      slotStart: new Date('2026-09-03T12:00:00.000Z'),
      service: { name: 'Haircut' },
    },
    ...overrides,
  };
}

describe('CancellationCourtesyWaiverService', () => {
  let service: CancellationCourtesyWaiverService;
  let prisma: {
    customerLedgerEntry: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
    auditLog: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let salonAccess: { assertOwnerAccess: jest.Mock };

  beforeEach(async () => {
    prisma = {
      customerLedgerEntry: {
        findUnique: jest.fn().mockResolvedValue(ledgerRow()),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(ledgerRow({ status: LedgerStatus.WAIVED })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        count: jest.fn().mockResolvedValue(0),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(prisma));
    salonAccess = { assertOwnerAccess: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CancellationCourtesyWaiverService,
        { provide: PrismaService, useValue: prisma },
        { provide: SalonAccessService, useValue: salonAccess },
      ],
    }).compile();
    service = moduleRef.get(CancellationCourtesyWaiverService);
  });

  it('keeps salon-owner authorization in front of every waiver', async () => {
    await service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1');
    expect(salonAccess.assertOwnerAccess).toHaveBeenCalledWith('owner-1', 'salon-1');
  });

  it('waives an outstanding cancellation charge and writes a reason-specific audit row', async () => {
    const result = await service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1');

    expect(result.ledgerEntry.status).toBe(LedgerStatus.WAIVED);
    expect(prisma.customerLedgerEntry.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'ledger-1',
        salonId: 'salon-1',
        customerId: 'customer-1',
        reason: LedgerReason.CANCELLATION_CHARGE,
        status: LedgerStatus.OUTSTANDING,
      }),
      data: { status: LedgerStatus.WAIVED },
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CANCELLATION_DUE_WAIVED' }),
    });
  });

  it(`blocks a sixth active courtesy waiver after ${CANCELLATION_COURTESY_WAIVER_LIMIT} are already waived`, async () => {
    prisma.customerLedgerEntry.count.mockResolvedValue(CANCELLATION_COURTESY_WAIVER_LIMIT);

    await expect(
      service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1'),
    ).rejects.toMatchObject({ code: 'LEDGER_ENTRY_NOT_WAIVABLE' });
    expect(prisma.customerLedgerEntry.updateMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('treats retrying an already-waived cancellation charge as an idempotent success', async () => {
    prisma.customerLedgerEntry.findUnique.mockResolvedValueOnce(
      ledgerRow({ status: LedgerStatus.WAIVED }),
    );

    const result = await service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1');

    expect(result.ledgerEntry.status).toBe(LedgerStatus.WAIVED);
    expect(prisma.customerLedgerEntry.count).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('never lets a no-show charge consume the cancellation courtesy path', async () => {
    prisma.customerLedgerEntry.findUnique.mockResolvedValueOnce(
      ledgerRow({ reason: LedgerReason.NO_SHOW_CHARGE }),
    );

    await expect(
      service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1'),
    ).rejects.toMatchObject({ code: 'LEDGER_ENTRY_NOT_WAIVABLE' });
    expect(prisma.customerLedgerEntry.count).not.toHaveBeenCalled();
  });

  it('restores a cancellation courtesy waiver to OUTSTANDING and audits the reversal', async () => {
    prisma.customerLedgerEntry.findUnique.mockResolvedValueOnce(
      ledgerRow({ status: LedgerStatus.WAIVED }),
    );
    prisma.customerLedgerEntry.findUniqueOrThrow.mockResolvedValueOnce(
      ledgerRow({ status: LedgerStatus.OUTSTANDING }),
    );

    const result = await service.restore('owner-1', 'salon-1', 'customer-1', 'ledger-1');

    expect(result.ledgerEntry.status).toBe(LedgerStatus.OUTSTANDING);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CANCELLATION_DUE_RESTORED' }),
    });
  });

  it('fails closed when the ledger entry belongs to another customer or salon', async () => {
    prisma.customerLedgerEntry.findUnique.mockResolvedValueOnce(
      ledgerRow({ customerId: 'someone-else' }),
    );

    await expect(
      service.waive('owner-1', 'salon-1', 'customer-1', 'ledger-1'),
    ).rejects.toMatchObject({ code: 'LEDGER_ENTRY_NOT_FOUND' });
    expect(prisma.customerLedgerEntry.updateMany).not.toHaveBeenCalled();
  });
});
