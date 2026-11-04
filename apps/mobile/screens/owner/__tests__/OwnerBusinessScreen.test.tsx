import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import OwnerBusinessScreen from '../OwnerBusinessScreen';
import { apiFetch } from '../../../lib/api';
import type { OfferDto } from '@barbercue/shared';

jest.mock('../../../lib/api', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => '00000000-0000-4000-8000-000000000000' }));
let mockSelectedSalonId = 'salon-owned-by-session';
jest.mock('../../../lib/salon-context', () => ({
  useSalon: () => ({ selectedSalonId: mockSelectedSalonId, selectedSalon: { id: mockSelectedSalonId, name: 'Synthetic Salon' } }),
}));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../../components/ui', () => {
  const { Pressable, Text, View } = require('react-native');
  const { createElement } = require('react');
  return {
    Button: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) =>
      createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, disabled, onPress }, createElement(Text, null, title)),
    Card: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    EmptyState: ({ title }: { title: string }) => createElement(Text, null, title),
    InlineError: ({ message }: { message: string }) => createElement(Text, { accessibilityRole: 'alert' }, message),
    Screen: ({ children }: { children: React.ReactNode }) => createElement(View, null, children),
    SectionHeader: ({ title, subtitle }: { title: string; subtitle: string }) => createElement(View, null, createElement(Text, null, title), createElement(Text, null, subtitle)),
  };
});

const fetchMock = apiFetch as jest.Mock;
let mockOfferItems: OfferDto[] = [];
const savedOffer: OfferDto = { id: '00000000-0000-4000-8000-000000000001', salonId: 'salon-owned-by-session', kind: 'OFFER', status: 'PAUSED', title: 'Existing deal', description: null, discountType: 'PERCENT', discountValue: 10, currency: 'INR', audience: 'ALL', inactiveDays: null, validFrom: '2026-11-05T03:30:00.000Z', validTo: '2026-12-05T03:30:00.000Z', maxRedemptions: null, perCustomerLimit: 1, serviceIds: [], redemptionCount: 0, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' };

const analytics = { currency: 'INR', appointmentsBooked: 4, completedCount: 2, estimatedServiceValue: 900, serviceValue: [], barberValue: [] };
const revenue = {
  currency: 'INR', hasRecordedPayments: true,
  today: { current: 100, previous: 0, delta: null },
  thisWeek: { current: 250, previous: 0, delta: null },
  thisMonth: { current: 500, previous: 0, delta: null },
  estimatedServiceValueToday: 0, unpaidInvoiceTotal: 50, unpaidInvoiceCount: 1, daily: [], weekly: [], monthly: [],
};

function defaultApiResponse(path: string, options?: { method?: string; body?: string }) {
  if (path.includes('/analytics?')) return Promise.resolve(analytics);
  if (path.endsWith('/revenue')) return Promise.resolve(revenue);
  if (path.endsWith('/timezone')) return Promise.resolve({ id: 'salon-owned-by-session', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false, suggestion: null });
  if (path.includes('/payments?')) return Promise.resolve({ from: '2026-01-01', to: '2026-01-01', currency: 'INR', items: [], nextCursor: null, totals: { received: 0, refunded: 0, net: 0, count: 0 }, byMethod: [] });
  if (path.includes('/capabilities')) return Promise.resolve({ features: { offers: { status: 'ENABLED' } } });
  if (path.endsWith('/timezone')) return Promise.resolve({ id: 'salon-owned-by-session', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false, suggestion: null });
  if (path.endsWith('/services')) return Promise.resolve([{ id: '00000000-0000-4000-8000-000000000002', name: 'Haircut', isActive: true }]);
  if (path.endsWith('/offers/preview')) return Promise.resolve({ offerId: null, currency: 'INR', eligibleByRule: null, eligibilityRule: 'ALL', lines: [{ serviceId: '00000000-0000-4000-8000-000000000002', serviceName: 'Haircut', basePrice: 300, discount: 45, finalPrice: 255, currency: 'INR' }], subtotal: 300, discount: 45, finalTotal: 255 });
  if (path.includes('/offers?')) return Promise.resolve({ items: mockOfferItems, nextCursor: null });
  if (path.includes('/reviews?')) return Promise.resolve({ items: [{ id: 'review-1', rating: 5, serviceName: 'Haircut', createdAt: '2026-10-01T00:00:00.000Z', customerPhone: null, customerEmail: null, comment: 'Synthetic review', ownerResponse: null }] });
  if (options?.method === 'PUT' && path.includes('/response')) return Promise.resolve({});
  return Promise.resolve({ items: [] });
}

describe('OwnerBusinessScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectedSalonId = 'salon-owned-by-session';
    mockOfferItems = [];
    fetchMock.mockImplementation(defaultApiResponse);
  });

  it('shows recorded collections separately from estimated service value', async () => {
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    expect(screen.getByText(/Estimated from completed services/)).toBeTruthy();
    expect(screen.getByText(/₹900\.00/)).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('dashboard/salons/salon-owned-by-session/analytics?range=30d'));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'dashboard/salons/salon-owned-by-session/revenue');
  });

  it('fails closed when the backend says offers are not enabled', async () => {
    fetchMock.mockImplementation((path: string, options?: { method?: string }) => path.includes('/capabilities')
      ? Promise.resolve({ features: { offers: { status: 'DISABLED' } } })
      : defaultApiResponse(path, options));
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Offers' })); });

    await waitFor(() => expect(screen.getByText('Offers are not enabled for this shop on the current backend.')).toBeTruthy());
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/offers?'));
  });

  it('sends the selected review response only to the selected shop review route', async () => {
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Reviews' })); });
    await waitFor(() => expect(screen.getByText('Synthetic review')).toBeTruthy());
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Write a response to this review'), 'Thank you'); });
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Save response' })); });

    expect(fetchMock).toHaveBeenCalledWith(
      'dashboard/salons/salon-owned-by-session/reviews/review-1/response',
      { method: 'PUT', body: JSON.stringify({ ownerResponse: 'Thank you' }) },
    );
  }, 15000);

  it('sends date-only payment filters using the shop timezone and an inclusive seven-day window', async () => {
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Payments' })); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/dashboard\/salons\/salon-owned-by-session\/payments\?/),
    ));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: '7 days' })); });
    await waitFor(() => expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/payments?from='))).toBe(true));

    await waitFor(() => {
      const latest = String(fetchMock.mock.calls.filter(([item]) => String(item).includes('/payments?from=')).at(-1)?.[0]);
      const latestParams = new URLSearchParams(latest.split('?')[1]);
      const latestFrom = latestParams.get('from');
      const latestTo = latestParams.get('to');
      expect(latestTo).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect((Date.parse(`${latestTo}T00:00:00.000Z`) - Date.parse(`${latestFrom}T00:00:00.000Z`)) / 86_400_000).toBe(6);
    }, { timeout: 15000 });

    const path = String(fetchMock.mock.calls.filter(([item]) => String(item).includes('/payments?from=')).at(-1)?.[0]);
    const params = new URLSearchParams(path.split('?')[1]);
    const from = params.get('from');
    const to = params.get('to');
    const expectedToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toBe(expectedToday);
    expect((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000).toBe(6);
  }, 15000);

  it('does not show the previous salon analytics when the newly selected salon request fails', async () => {
    const view = await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getByText(/₹900\.00/)).toBeTruthy());
    mockSelectedSalonId = 'salon-other-owner';
    fetchMock.mockImplementation((path: string, options?: { method?: string; body?: string }) =>
      String(path).includes('/salon-other-owner/') ? Promise.reject(new Error('synthetic unavailable')) : defaultApiResponse(path, options));
    await act(async () => { await view.rerender(<OwnerBusinessScreen />); });

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/₹900\.00/)).toBeNull();
  }, 15000);

  it('creates a server-validated draft and checks prices through the owner API', async () => {
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Offers' })); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create an offer' })).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Create an offer' })); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Offer name'), 'Autumn deal'); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Discount value'), '15'); });
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Check prices' })); });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      'dashboard/salons/salon-owned-by-session/offers/preview',
      expect.objectContaining({ method: 'POST', body: expect.stringContaining('"title":"Autumn deal"') }),
    ));
    expect(screen.getAllByText(/255/).length).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Save as draft' })); });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path, options]) => path === 'dashboard/salons/salon-owned-by-session/offers' && options?.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toMatchObject({ title: 'Autumn deal', discountValue: 15, audience: 'ALL' });
      expect(call[1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/i);
    });
  }, 15000);

  it('edits a paused offer with a minimal patch and does not expose editing for active offers', async () => {
    mockOfferItems = [savedOffer];
    await render(<OwnerBusinessScreen />);
    await waitFor(() => expect(screen.getAllByText('Recorded collections').length).toBeGreaterThan(0));
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Offers' })); });
    await waitFor(() => expect(screen.getByText('Existing deal')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Edit' })); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText('Offer name'), 'Revised deal'); });
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Save changes' })); });
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([path, options]) => path === 'dashboard/salons/salon-owned-by-session/offers/' + savedOffer.id && options?.method === 'PATCH');
      expect(call).toBeTruthy();
      expect(JSON.parse(call[1].body)).toEqual({ title: 'Revised deal' });
    });
  }, 15000);

});
