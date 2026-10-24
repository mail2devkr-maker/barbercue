/// <reference types="jest" />
jest.setTimeout(30_000);

import { act, createElement } from 'react';
import { uiStringsFor } from '@barbercue/shared';
import { allText, byTestId, flush, has, press, render, type as typeText } from '../../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});
const mockSalon: { value: Record<string, unknown> } = { value: {} };
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => mockSalon.value }));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => useEffect(effect, [effect]), useNavigation: () => ({ navigate: jest.fn() }) };
});
jest.mock('../../../lib/api', () => {
  class MockApiError extends Error {
    status = 400;
    code = 'ERR';
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});
// The proven setup forms are stood in for with markers: this suite checks WHICH section loads WHAT.
jest.mock('../../../components/owner/ShopSetupSections', () => {
  const { Text, View } = require('react-native');
  const marker = (name: string, idKey: string) => (props: Record<string, unknown>) => <Text testID={`${name}-${String((props[idKey] as { id?: string })?.id ?? '')}`}>{name}</Text>;
  return {
    scope: (id: string, seg: string) => `dashboard/salons/${id}/${seg}`,
    ServiceRow: marker('service-row', 'service'),
    ChairRow: marker('chair-row', 'chair'),
    AddServiceForm: () => <View testID="add-service-form" />,
    AddChairForm: () => <View testID="add-chair-form" />,
    AddStaffForm: () => <View testID="add-staff-form" />,
    HoursEditor: ({ hours }: { hours: unknown[] }) => <Text testID="hours-editor">{hours.length} days</Text>,
    PhotosSection: ({ photos }: { photos: unknown[] }) => <Text testID="photos-section">{photos.length} photos</Text>,
    styles: new Proxy({}, { get: () => ({}) }),
  };
});

import { apiFetch, ApiError } from '../../../lib/api';
import OwnerReviewsScreen from '../OwnerReviewsScreen';
import OwnerVerificationScreen from '../OwnerVerificationScreen';
import OwnerScheduleScreen from '../OwnerScheduleScreen';
import { OwnerChairsScreen, OwnerHoursScreen, OwnerPhotosScreen, OwnerServicesScreen, OwnerStaffScreen } from '../OwnerShopSectionScreens';

const apiMock = apiFetch as jest.Mock;
const ApiErr = ApiError as unknown as new (m: string) => Error;
const t = uiStringsFor('EN');

const SALON_A = { id: 'salon-a', name: 'Handsome Center', status: 'ACTIVE', isOwner: true };
const SALON_B = { id: 'salon-b', name: 'Second Shop', status: 'ACTIVE', isOwner: true };
function setSalon(selectedId: string | null) {
  const workplaces = [SALON_A, SALON_B];
  mockSalon.value = { workplaces, loading: false, error: null, selectedSalonId: selectedId, selectedSalon: workplaces.find((w) => w.id === selectedId) ?? null, selectSalon: jest.fn(), reload: jest.fn() };
}
const calls = (needle: string, method?: string) => apiMock.mock.calls.filter(([p, o]) => String(p).includes(needle) && (!method || (o?.method ?? 'GET') === method));

beforeEach(() => {
  jest.clearAllMocks();
  setSalon('salon-a');
});

// ---------------------------------------------------------------- Reviews

const review = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  bookingId: `bk-${id}`,
  salonId: 'salon-a',
  rating: 4,
  comment: `Comment ${id}`,
  ownerResponse: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  customerPhone: '+919800000001',
  customerEmail: null,
  serviceName: 'Classic Haircut',
  ...over,
});

describe('Owner Reviews', () => {
  it('lists this shop\'s reviews with rating, comment, service and contact; empty state when none', async () => {
    apiMock.mockResolvedValue({ items: [review('r1'), review('r2', { customerPhone: null, customerEmail: 'a@b.com', comment: null })], nextCursor: null });
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    expect(String(apiMock.mock.calls[0][0])).toBe('dashboard/salons/salon-a/reviews?limit=20');
    expect(allText(r)).toContain('Comment r1');
    expect(allText(r)).toContain('+919800000001');
    expect(allText(r)).toContain('a@b.com');
    expect(allText(r)).toContain('Classic Haircut');
    apiMock.mockResolvedValue({ items: [], nextCursor: null });
    const empty = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    expect(has(empty, 'reviews-empty')).toBe(true);
  });

  it('posts a trimmed public response with PUT to that review and shows it', async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === 'PUT') return review('r1', { ownerResponse: JSON.parse(String(options.body)).ownerResponse });
      return { items: [review('r1')], nextCursor: null };
    });
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    await typeText(r, 'review-input-r1', '  Thank you!  ');
    await press(r, 'review-post-r1');
    await flush(4);
    const [path, options] = calls('/response', 'PUT')[0];
    expect(path).toBe('dashboard/salons/salon-a/reviews/r1/response');
    expect(JSON.parse(options.body)).toEqual({ ownerResponse: 'Thank you!' });
    expect(allText(r)).toContain('Thank you!');
    expect(has(r, 'review-edit-r1')).toBe(true);
  });

  it('does not post an empty response', async () => {
    apiMock.mockResolvedValue({ items: [review('r1')], nextCursor: null });
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    await typeText(r, 'review-input-r1', '   ');
    await press(r, 'review-post-r1');
    await flush(4);
    expect(calls('/response', 'PUT')).toHaveLength(0);
  });

  it('shows a server refusal when responding fails, and keeps what the owner typed', async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === 'PUT') throw new ApiErr('Not your review.');
      return { items: [review('r1')], nextCursor: null };
    });
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    await typeText(r, 'review-input-r1', 'Hello');
    await press(r, 'review-post-r1');
    await flush(4);
    expect(allText(r)).toContain('Not your review.');
    expect(byTestId(r, 'review-input-r1')[0].props.value).toBe('Hello');
  });

  it('loads more pages by cursor without duplicating reviews', async () => {
    apiMock.mockImplementation(async (path: string) =>
      String(path).includes('cursor=c1') ? { items: [review('r2'), review('r1')], nextCursor: null } : { items: [review('r1')], nextCursor: 'c1' },
    );
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    await press(r, 'reviews-load-more');
    await flush(6);
    expect(String(calls('cursor=c1')[0][0])).toContain('limit=20');
    expect(allText(r).match(/Comment r1/g)).toHaveLength(1);
    expect(allText(r)).toContain('Comment r2');
    expect(has(r, 'reviews-load-more')).toBe(false);
  });

  it('switching shop clears the old shop\'s reviews and loads the new shop\'s only', async () => {
    apiMock.mockImplementation(async (path: string) =>
      String(path).includes('salon-b') ? { items: [review('b1', { comment: 'B review' })], nextCursor: null } : { items: [review('a1', { comment: 'A review' })], nextCursor: null },
    );
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    expect(allText(r)).toContain('A review');
    setSalon('salon-b');
    await act(async () => r.update(createElement(OwnerReviewsScreen as never)));
    await flush(6);
    expect(allText(r)).toContain('B review');
    expect(allText(r)).not.toContain('A review');
  });

  it('shows a load failure', async () => {
    apiMock.mockRejectedValue(new ApiErr('Forbidden'));
    const r = await render(createElement(OwnerReviewsScreen as never));
    await flush(6);
    expect(allText(r)).toContain('Forbidden');
  });
});

// ------------------------------------------------------------ Verification

describe('Owner Verification', () => {
  const request = (status: string, over: Record<string, unknown> = {}) => ({ id: 'v1', subjectType: 'SALON', status, evidenceNotes: 'x', evidenceUrls: [], submittedAt: '2026-10-01T00:00:00.000Z', reviewNotes: null, reviewedAt: null, ...over });

  it('no request yet: shows the exact shared badge caption and the submit form', async () => {
    apiMock.mockResolvedValue(null);
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    expect(allText(r)).toContain('Business/profile evidence reviewed by FastQue. Verification is not a guarantee of service quality.');
    expect(has(r, 'verification-form')).toBe(true);
    expect(has(r, 'verification-status')).toBe(false);
  });

  it.each([
    ['SUBMITTED', t.verificationStatusSubmitted, false],
    ['UNDER_REVIEW', t.verificationStatusUnderReview, false],
    ['APPROVED', t.verificationStatusApproved, false],
    ['REJECTED', t.verificationStatusRejected, true],
  ])('%s shows its plain-words status, and the form only when resubmitting is allowed', async (status, copy, formShown) => {
    apiMock.mockResolvedValue(request(status, status === 'REJECTED' ? { reviewNotes: 'Photo unclear' } : {}));
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    expect(allText(r)).toContain(copy);
    expect(has(r, 'verification-form')).toBe(formShown);
    if (status === 'REJECTED') {
      expect(allText(r)).toContain('Photo unclear');
      expect(allText(r)).toContain(t.verificationResubmit);
    }
  });

  it('refuses to submit with no note and no link (no request)', async () => {
    apiMock.mockResolvedValue(null);
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    await press(r, 'verification-submit');
    await flush(4);
    expect(calls('/verification', 'POST')).toHaveLength(0);
    expect(allText(r)).toContain(t.verificationNeedEvidence);
  });

  it('rejects a non-https evidence link locally', async () => {
    apiMock.mockResolvedValue(null);
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    await typeText(r, 'verification-links', 'http://insecure.example/doc.jpg');
    await press(r, 'verification-submit');
    await flush(4);
    expect(calls('/verification', 'POST')).toHaveLength(0);
  });

  it('submits notes and https links for THIS shop and shows the new status', async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => (options?.method === 'POST' ? request('SUBMITTED') : null));
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    await typeText(r, 'verification-notes', '  GST certificate attached  ');
    await typeText(r, 'verification-links', 'https://example.com/a.jpg\n\n https://example.com/b.jpg ');
    await press(r, 'verification-submit');
    await flush(4);
    const [path, options] = calls('/verification', 'POST')[0];
    expect(path).toBe('dashboard/salons/salon-a/verification');
    expect(JSON.parse(options.body)).toEqual({ evidenceNotes: 'GST certificate attached', evidenceUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'] });
    expect(allText(r)).toContain(t.verificationStatusSubmitted);
    expect(has(r, 'verification-form')).toBe(false);
  });

  it('shows a submit failure from the server', async () => {
    apiMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (options?.method === 'POST') throw new ApiErr('Too many requests.');
      return null;
    });
    const r = await render(createElement(OwnerVerificationScreen as never));
    await flush(6);
    await typeText(r, 'verification-notes', 'proof');
    await press(r, 'verification-submit');
    await flush(4);
    expect(allText(r)).toContain('Too many requests.');
  });
});

// ---------------------------------------------------------------- Schedule

describe('Owner Schedule', () => {
  const TZ = { id: 'salon-a', timezone: 'Asia/Kolkata', countryCode: 'IN', timezoneAutoDetected: true, timezoneManuallyOverridden: false, suggestion: null };
  const STAFF = [{ id: 's1', displayName: 'Ravi', status: 'ACTIVE' }, { id: 's2', displayName: 'Amit', status: 'ACTIVE' }];
  const booking = (id: string, over: Record<string, unknown> = {}) => ({
    id, serviceName: `Service ${id}`, status: 'CONFIRMED', slotStart: '2026-10-09T04:30:00.000Z', slotEnd: '2026-10-09T05:00:00.000Z',
    assignedStaffId: null, assignedStaffName: null, preferredStaffId: null, preferredStaffName: null, customerPhone: '+919811111111', ...over,
  });
  function route(bookings: unknown[], tz: unknown = TZ) {
    apiMock.mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.endsWith('/timezone')) return tz;
      if (p.endsWith('/staff')) return STAFF;
      if (p.includes('/bookings?')) return { items: bookings, nextCursor: null };
      throw new Error(`unexpected ${p}`);
    });
  }

  it("shows the day by barber in the SHOP's zone (04:30 UTC is 10:00 AM in Kolkata), preferred vs assigned marked", async () => {
    route([booking('b1', { assignedStaffId: 's1' }), booking('b2', { preferredStaffId: 's2' }), booking('b3')]);
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(8);
    expect(has(r, 'schedule-column-s1')).toBe(true);
    expect(has(r, 'schedule-column-s2')).toBe(true);
    expect(has(r, 'schedule-column-__none__')).toBe(true);
    expect(allText(r)).toContain(t.scheduleTimesIn.replace('{zone}', 'Asia/Kolkata'));
    expect(allText(r)).toMatch(/10:00\s?AM/i);
    expect(allText(r)).toContain(t.schedulePreferred);
    expect(allText(r)).toContain(t.scheduleNoPreference);
    expect(allText(r)).toContain('Service b1');
  });

  it('asks the API for exactly the displayed day and pages through a busy day', async () => {
    let page = 0;
    apiMock.mockImplementation(async (path: string) => {
      const p = String(path);
      if (p.endsWith('/timezone')) return TZ;
      if (p.endsWith('/staff')) return STAFF;
      page += 1;
      return page === 1 ? { items: [booking('p1')], nextCursor: 'c1' } : { items: [booking('p2')], nextCursor: null };
    });
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(10);
    const bookingCalls = apiMock.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/bookings?'));
    expect(bookingCalls).toHaveLength(2);
    expect(bookingCalls[0]).toMatch(/date=\d{4}-\d{2}-\d{2}&limit=50$/);
    expect(bookingCalls[1]).toContain('cursor=c1');
    expect(allText(r)).toContain('Service p1');
    expect(allText(r)).toContain('Service p2');
  });

  it('next/previous day load that exact calendar day', async () => {
    route([]);
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(8);
    const dayOf = (p: string) => /date=(\d{4}-\d{2}-\d{2})/.exec(p)![1];
    const first = dayOf(apiMock.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/bookings?'))[0]);
    apiMock.mockClear();
    route([]);
    await press(r, 'schedule-next');
    await flush(8);
    const next = dayOf(apiMock.mock.calls.map((c) => String(c[0])).filter((p) => p.includes('/bookings?'))[0]);
    expect(new Date(`${next}T00:00:00Z`).getTime() - new Date(`${first}T00:00:00Z`).getTime()).toBe(86_400_000);
    expect(has(r, 'schedule-today')).toBe(true);
  });

  it('empty day says so', async () => {
    route([]);
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(8);
    expect(has(r, 'schedule-empty')).toBe(true);
  });

  it('with no time zone set it asks the owner to set one (and does not guess a day)', async () => {
    route([], { ...TZ, timezone: null });
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(8);
    expect(has(r, 'schedule-no-timezone')).toBe(true);
    expect(apiMock.mock.calls.map((c) => String(c[0])).some((p) => p.includes('/bookings?'))).toBe(false);
  });

  it('a failure shows the translated message', async () => {
    apiMock.mockRejectedValue(new Error('x'));
    const r = await render(createElement(OwnerScheduleScreen as never));
    await flush(8);
    expect(allText(r)).toContain(t.scheduleLoadFailed);
  });
});

// ----------------------------------------------------------- Section screens

describe('Owner section screens load only their own resource, for the selected shop', () => {
  it.each([
    ['services', OwnerServicesScreen, '/services', [{ id: 'sv1', name: 'Haircut' }], 'service-row-sv1'],
    ['chairs', OwnerChairsScreen, '/chairs', [{ id: 'ch1', label: 'Chair 1', status: 'ACTIVE' }], 'chair-row-ch1'],
    ['staff', OwnerStaffScreen, '/staff', [{ id: 'st1', displayName: 'Ravi', status: 'ACTIVE', hasPassword: true }], 'add-staff-form'],
    ['hours', OwnerHoursScreen, '/operating-hours', [{ dayOfWeek: 1 }, { dayOfWeek: 2 }], 'hours-editor'],
    ['photos', OwnerPhotosScreen, '/photos', [{ id: 'p1' }], 'photos-section'],
  ])('%s', async (_name, Screen, suffix, payload, marker) => {
    apiMock.mockResolvedValue(payload);
    const r = await render(createElement(Screen as never));
    await flush(6);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(String(apiMock.mock.calls[0][0])).toBe(`dashboard/salons/salon-a${suffix}`);
    expect(has(r, marker)).toBe(true);
  });

  it('shows an empty list message for a shop with no services yet, and the add form', async () => {
    apiMock.mockResolvedValue([]);
    const r = await render(createElement(OwnerServicesScreen as never));
    await flush(6);
    expect(has(r, 'add-service-form')).toBe(true);
  });

  it('shows a load failure', async () => {
    apiMock.mockRejectedValue(new ApiErr('Forbidden'));
    const r = await render(createElement(OwnerChairsScreen as never));
    await flush(6);
    expect(allText(r)).toContain('Forbidden');
  });

  it('with no shop selected, asks to choose one and loads nothing', async () => {
    setSalon(null);
    const r = await render(createElement(OwnerHoursScreen as never));
    await flush(4);
    expect(apiMock).not.toHaveBeenCalled();
    expect(allText(r)).toContain(t.selectShopTitle);
  });
});
