import { SalonPaymentQrService } from './salon-payment-qr.service';
import { BookingPaymentInfoService } from '../bookings/booking-payment-info.service';
import { setSalonUpiSchema } from '@barbercue/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

describe('Salon UPI routing — existing owner/admin scope', () => {
  const details = { upiVpa: 'merchant@bank', upiPayeeName: 'Shop & Sons' };
  let row: Record<string, unknown>;
  let actor: jest.Mock;
  let prisma: any;
  let service: SalonPaymentQrService;
  beforeEach(() => {
    row = { paymentQrImageUrl: 'https://cdn.example/qr.png', upiVpa: null, upiPayeeName: null };
    actor = jest.fn().mockResolvedValue('OWNER');
    prisma = {
      salonPaymentPolicy: {
        findUnique: jest.fn().mockImplementation(async () => ({ ...row })),
        upsert: jest.fn().mockImplementation(async ({ update }) => { row = { ...row, ...update }; return { ...row }; }),
      },
      auditLog: { create: jest.fn() },
      city: { findUnique: jest.fn().mockResolvedValue({ countryCode: 'IN' }) },
    };
    prisma.$transaction = jest.fn(async (fn) => {
      const before = { ...row };
      try { return await fn(prisma); } catch (err) { row = before; throw err; }
    });
    service = new SalonPaymentQrService(prisma, { assertOwnerOrAdminAccess: actor } as never, {} as never);
  });
  it('QR-only remains available with no direct-pay routing', async () => {
    const info = new BookingPaymentInfoService(prisma, { getSalonOrThrow: async () => ({ currency: null, cityId: 'c' }) } as never);
    expect(await info.get('s')).toMatchObject({ onlinePaymentAvailable: true, upiVpa: null, currency: 'INR' });
  });
  it('owner saves/retrieves trimmed routing without changing QR or other policy fields', async () => {
    const result = await service.setUpi('owner', 's', { upiVpa: ' merchant@bank ', upiPayeeName: ' Shop & Sons ' });
    expect(actor).toHaveBeenCalledWith('owner', 's');
    expect(result).toMatchObject({ ...details, paymentQrImageUrl: 'https://cdn.example/qr.png' });
    expect(await service.get('owner', 's')).toMatchObject(details);
    expect(prisma.salonPaymentPolicy.upsert.mock.calls[0][0].update).toEqual(details);
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['missing-at', 'two@@bank', 'space me@bank', 'bad@bank?am=1', 'bad/@bank', '@bank'])('rejects malformed VPA %s at HTTP pipe and service', async (upiVpa) => {
    const input = { ...details, upiVpa };
    expect(() => new ZodValidationPipe(setSalonUpiSchema).transform(input, { type: 'body' })).toThrow();
    await expect(service.setUpi('owner', 's', input)).rejects.toMatchObject({ code: 'INVALID_UPI_DETAILS' });
    expect(prisma.salonPaymentPolicy.upsert).not.toHaveBeenCalled();
  });
  it('customer/staff/unrelated owner cannot read or write routing', async () => {
    actor.mockRejectedValue(new Error('denied'));
    await expect(service.setUpi('unrelated', 's', details)).rejects.toThrow('denied');
    await expect(service.get('unrelated', 's')).rejects.toThrow('denied');
    expect(prisma.salonPaymentPolicy.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('delegated admin updates are audited atomically', async () => {
    actor.mockResolvedValue('PLATFORM_ADMIN');
    await service.setUpi('admin', 's', details);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorUserId: 'admin', entityId: 's',
      metadata: expect.objectContaining({ via: 'upi-routing', after: details }) }) });
  });
  it('audit failure rolls back the routing write in the transaction', async () => {
    actor.mockResolvedValue('PLATFORM_ADMIN');
    prisma.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(service.setUpi('admin', 's', details)).rejects.toThrow('audit unavailable');
    expect(row.upiVpa).toBeNull();
  });
  it('clearing optional routing retains QR-only mode', async () => {
    await service.setUpi('owner', 's', details);
    await service.setUpi('owner', 's', { upiVpa: '', upiPayeeName: '' });
    expect(row).toMatchObject({ upiVpa: null, upiPayeeName: null, paymentQrImageUrl: 'https://cdn.example/qr.png' });
  });
  it('non-INR salon never silently uses INR', async () => {
    const info = new BookingPaymentInfoService(prisma, { getSalonOrThrow: async () => ({ currency: 'GBP' }) } as never);
    expect((await info.get('s')).currency).toBe('GBP');
    expect(prisma.city.findUnique).not.toHaveBeenCalled();
  });
});
