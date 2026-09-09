import { PrepaymentRequirement } from '@barbercue/shared';
import { BookingPaymentInfoService } from './booking-payment-info.service';

describe('BookingPaymentInfoService', () => {
  it('reports UPI QR available without exposing provider secrets', async () => {
    const prisma: any = { salonPaymentPolicy: { findUnique: jest.fn().mockResolvedValue({ paymentQrImageUrl: 'https://cdn.example/qr.png', prepaymentRequirement: 'NONE', prepaymentPercentage: null }) } };
    const availability: any = { getSalonOrThrow: jest.fn().mockResolvedValue({ id: 's1' }) };
    const service = new BookingPaymentInfoService(prisma, availability);
    await expect(service.get('s1')).resolves.toEqual({
      onlinePaymentAvailable: true,
      paymentMethod: 'UPI_QR',
      paymentQrImageUrl: 'https://cdn.example/qr.png',
      prepaymentRequirement: PrepaymentRequirement.NONE,
      prepaymentPercentage: null,
    });
  });

  it('reports unavailable when the shop has no QR', async () => {
    const prisma: any = { salonPaymentPolicy: { findUnique: jest.fn().mockResolvedValue(null) } };
    const availability: any = { getSalonOrThrow: jest.fn().mockResolvedValue({ id: 's1' }) };
    const service = new BookingPaymentInfoService(prisma, availability);
    const result = await service.get('s1');
    expect(result.onlinePaymentAvailable).toBe(false);
    expect(result.paymentQrImageUrl).toBeNull();
  });
});
