import { BookingSource, OfferErrorCode } from '@barbercue/shared';
import { Prisma } from '@prisma/client';
import { OffersService } from './offers.service';

// Offer booking rules: validity and Happy Hours are judged at the APPOINTMENT time in the salon's
// own time zone, a minimum spend is checked against the booked services, and a percentage
// discount respects its cap — all server-side.

const SALON = 'salon-1';
const CUSTOMER = 'customer-1';
const haircut = {
  id: 'svc-1',
  name: 'Haircut',
  price: new Prisma.Decimal(500),
};
const shave = { id: 'svc-2', name: 'Shave', price: new Prisma.Decimal(100) };

function offer(over: Record<string, unknown> = {}) {
  return {
    id: 'offer-1',
    salonId: SALON,
    status: 'ACTIVE',
    title: 'Weekday happy hours',
    discountType: 'PERCENT',
    discountValue: new Prisma.Decimal(20),
    currency: 'INR',
    audience: 'ALL',
    inactiveDays: null,
    validFrom: new Date('2026-10-01T00:00:00Z'),
    validTo: new Date('2026-11-30T00:00:00Z'),
    maxRedemptions: null,
    perCustomerLimit: 1,
    minimumBookingAmount: null,
    maximumDiscountAmount: null,
    applicableDays: [],
    dailyStartTime: null,
    dailyEndTime: null,
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    services: [],
    _count: { redemptions: 0 },
    ...over,
  };
}

function makeService(row: ReturnType<typeof offer>) {
  const prisma = {
    offer: { findFirst: jest.fn().mockResolvedValue(row) },
    salon: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: 'Asia/Kolkata',
        city: { countryCode: 'IN' },
      }),
    },
    offerRedemption: { count: jest.fn().mockResolvedValue(0) },
  };
  return new OffersService(prisma as never, {} as never);
}

const now = new Date('2026-10-26T04:00:00Z'); // Mon 09:30 IST

async function check(
  row: ReturnType<typeof offer>,
  appointmentAt: Date,
  services = [haircut],
) {
  return makeService(row).previewForBooking(
    SALON,
    CUSTOMER,
    row.id,
    services,
    BookingSource.WEB,
    now,
    appointmentAt,
  );
}

describe('offer booking rules', () => {
  it('judges validity at the appointment time, not at booking time', async () => {
    const nextMonthOnly = offer({
      validFrom: new Date('2026-11-01T00:00:00Z'),
    });
    await expect(
      check(nextMonthOnly, new Date('2026-10-28T09:30:00Z')),
    ).rejects.toMatchObject({ code: OfferErrorCode.EXPIRED });
    await expect(
      check(nextMonthOnly, new Date('2026-11-03T09:30:00Z')),
    ).resolves.toMatchObject({ discountAmountPaise: 10000 });
  });

  it('Happy Hours: only on the chosen weekdays, inside the salon-local window', async () => {
    const happyHours = offer({
      applicableDays: [1, 2, 3, 4, 5],
      dailyStartTime: '14:00',
      dailyEndTime: '17:00',
    });
    // Tue 27 Oct 15:00 IST = 09:30Z → applies.
    await expect(
      check(happyHours, new Date('2026-10-27T09:30:00Z')),
    ).resolves.toMatchObject({ discountAmountPaise: 10000 });
    // Tue 18:00 IST → outside the window.
    await expect(
      check(happyHours, new Date('2026-10-27T12:30:00Z')),
    ).rejects.toMatchObject({ code: OfferErrorCode.NOT_ELIGIBLE });
    // Sat 31 Oct 15:00 IST → not a chosen day.
    await expect(
      check(happyHours, new Date('2026-10-31T09:30:00Z')),
    ).rejects.toMatchObject({ code: OfferErrorCode.NOT_ELIGIBLE });
  });

  it('checks the minimum spend against all booked services', async () => {
    const minSpend = offer({
      discountType: 'FLAT',
      discountValue: new Prisma.Decimal(100),
      minimumBookingAmount: new Prisma.Decimal(550),
    });
    const at = new Date('2026-10-27T09:30:00Z');
    await expect(check(minSpend, at, [haircut])).rejects.toMatchObject({
      code: OfferErrorCode.NOT_ELIGIBLE,
    });
    await expect(check(minSpend, at, [haircut, shave])).resolves.toMatchObject({
      discountAmountPaise: 10000,
    });
  });

  it('caps a percentage discount at its maximum amount', async () => {
    const capped = offer({
      discountValue: new Prisma.Decimal(50),
      maximumDiscountAmount: new Prisma.Decimal(120),
    });
    await expect(
      check(capped, new Date('2026-10-27T09:30:00Z'), [haircut, shave]),
    ).resolves.toMatchObject({ discountAmountPaise: 12000 });
  });
});
