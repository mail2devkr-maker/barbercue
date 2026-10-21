import type { CustomerAssistantSearchInput } from '@barbercue/shared';
import { CustomerAssistantSearchService } from './customer-assistant-search.service';

describe('CustomerAssistantSearchService', () => {
  const prisma = { service: { findMany: jest.fn() } };
  const salons = { search: jest.fn() };
  const availability = {
    getSalonTimeZone: jest.fn(),
    getAvailability: jest.fn(),
  };
  let service: CustomerAssistantSearchService;

  const input: CustomerAssistantSearchInput = {
    serviceQuery: 'hair',
    date: '2026-10-22',
    city: 'hajipur',
    limit: 2,
  };
  const salon = {
    id: 'salon-1',
    publicId: 'BC-SHOP-1',
    name: 'Example Salon',
    slug: 'example',
    citySlug: 'hajipur',
    countryCode: 'IN',
    distanceKm: null,
    currency: 'INR',
    isClosedForToday: false,
  };

  beforeEach(() => {
    jest.resetAllMocks();
    salons.search.mockResolvedValue({ items: [salon], nextCursor: null });
    prisma.service.findMany.mockResolvedValue([
      {
        id: 'service-category',
        salonId: 'salon-1',
        name: 'Beard Trim',
        category: 'Hair',
        price: 50,
        durationMinutes: 15,
      },
      {
        id: 'service-name',
        salonId: 'salon-1',
        name: 'Haircut',
        category: 'Grooming',
        price: 100,
        durationMinutes: 30,
      },
    ]);
    availability.getSalonTimeZone.mockResolvedValue('Asia/Kolkata');
    availability.getAvailability.mockResolvedValue([
      {
        slotStart: '2026-10-22T03:30:00.000Z',
        slotEnd: '2026-10-22T04:00:00.000Z',
        available: true,
        state: 'AVAILABLE',
      },
      {
        slotStart: '2026-10-22T04:00:00.000Z',
        slotEnd: '2026-10-22T04:30:00.000Z',
        available: false,
        state: 'OCCUPIED',
      },
    ]);
    service = new CustomerAssistantSearchService(
      prisma as never,
      salons as never,
      availability as never,
    );
  });

  it('returns deterministic catalog data and only real available slots, with no booking side effect', async () => {
    const result = await service.search(input);
    expect(result).toMatchObject({
      mode: 'DETERMINISTIC_CATALOG_AVAILABILITY',
      generated: false,
      bookingConfirmationRequired: true,
      candidates: [
        {
          salon: { id: salon.id, name: salon.name },
          service: { id: 'service-name', name: 'Haircut', price: 100 },
          timeZone: 'Asia/Kolkata',
          availableSlots: [
            {
              slotStart: '2026-10-22T03:30:00.000Z',
              slotEnd: '2026-10-22T04:00:00.000Z',
            },
          ],
        },
      ],
    });
    expect(result.candidates[0]).not.toHaveProperty('owner');
    expect(result.candidates[0]).not.toHaveProperty('phone');
    expect(availability.getAvailability).toHaveBeenCalledWith(
      salon.id,
      ['service-name'],
      input.date,
    );
    expect(salons.search).toHaveBeenCalledWith(
      expect.objectContaining({ service: input.serviceQuery }),
    );
  });

  it('returns an empty list when no salons match without querying services', async () => {
    salons.search.mockResolvedValueOnce({ items: [], nextCursor: null });
    const result = await service.search(input);
    expect(result.candidates).toEqual([]);
    expect(prisma.service.findMany).not.toHaveBeenCalled();
  });

  it('does not expose salons without a resolvable timezone or available slots', async () => {
    availability.getSalonTimeZone.mockResolvedValueOnce(null);
    const result = await service.search(input);
    expect(result.candidates).toEqual([]);
    expect(availability.getAvailability).not.toHaveBeenCalled();
  });

  it('skips shops paused by the existing owner setting', async () => {
    salons.search.mockResolvedValueOnce({
      items: [{ ...salon, isClosedForToday: true }],
      nextCursor: null,
    });
    const result = await service.search(input);
    expect(result.candidates).toEqual([]);
    expect(availability.getAvailability).not.toHaveBeenCalled();
  });

  it('propagates booking-engine failures rather than manufacturing availability', async () => {
    availability.getAvailability.mockRejectedValueOnce(
      new Error('availability unavailable'),
    );
    await expect(service.search(input)).rejects.toThrow(
      'availability unavailable',
    );
  });
});
