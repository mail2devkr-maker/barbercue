/// <reference types="jest" />
jest.setTimeout(30_000);

import { act, createElement } from 'react';
import { CUSTOMER_SERVICE_CATEGORIES, uiStringsFor } from '@barbercue/shared';
import { allText, byTestId, byTestIdPrefix, flush, has, press, render, type as typeText } from '../../lib/location/__fixtures__/render';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children: unknown }) => children,
}));
jest.mock('../../lib/language-context', () => {
  const { uiStringsFor: strings } = require('@barbercue/shared');
  return { useLanguage: () => ({ language: 'EN', setLanguage: jest.fn(), t: strings('EN') }) };
});
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(), ApiError: class extends Error {} }));

import AllServicesScreen, { buildRows } from '../AllServicesScreen';
import GuestAllServicesScreen from '../GuestAllServicesScreen';

const mockGuestNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockGuestNavigate }) }));

const t = uiStringsFor('EN');
const navigation = { navigate: jest.fn() };
const mount = () => render(createElement(AllServicesScreen as never, { navigation, route: { key: 'k', name: 'AllServices' } } as never));
const cardIds = (r: Awaited<ReturnType<typeof render>>) => [...new Set(byTestIdPrefix(r, 'service-card-').map((n) => String(n.props.testID)))];

beforeEach(() => jest.clearAllMocks());

describe('All Services screen', () => {
  it('opens as its own catalogue — it does not navigate to shop search on its own', async () => {
    const r = await mount();
    await flush();
    expect(navigation.navigate).not.toHaveBeenCalled();
    expect(allText(r)).toContain(t.allServicesNote);
    expect(has(r, 'all-services-list')).toBe(true);
  });

  it('shows services immediately, with no search required, starting with the first category', async () => {
    const r = await mount();
    await flush();
    const first = CUSTOMER_SERVICE_CATEGORIES[0];
    expect(allText(r)).toContain(first.label);
    expect(cardIds(r).length).toBeGreaterThan(0);
    expect(cardIds(r)).toContain(`service-card-${first.services[0].id}`);
  });

  it('lists a chip for every real category plus "All"', async () => {
    const r = await mount();
    await flush();
    expect(has(r, 'category-chip-all')).toBe(true);
    for (const category of CUSTOMER_SERVICE_CATEGORIES) expect(has(r, `category-chip-${category.id}`)).toBe(true);
  });

  it('a category chip narrows the catalogue to that category, and tapping it again restores everything', async () => {
    const r = await mount();
    await flush();
    await press(r, 'category-chip-nails');
    const nails = CUSTOMER_SERVICE_CATEGORIES.find((c) => c.id === 'nails')!;
    const shown = cardIds(r);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((id) => nails.services.some((s) => `service-card-${s.id}` === id))).toBe(true);
    await press(r, 'category-chip-nails');
    // Everything again: the first category's photographed services are back.
    expect(cardIds(r)).toContain('service-card-womens-haircut');
  });

  it('the secondary in-screen filter narrows by name, case-insensitively, and has an honest no-match state', async () => {
    const r = await mount();
    await flush();
    await typeText(r, 'all-services-filter', 'FACIAL');
    await flush();
    expect(cardIds(r).length).toBeGreaterThan(0);
    await typeText(r, 'all-services-filter', 'zzzzqq');
    await flush();
    expect(cardIds(r)).toEqual([]);
    expect(allText(r)).toContain(t.allServicesNoMatch);
  });

  it('tapping a service opens shop search for that exact service keyword (no price, no invented availability)', async () => {
    const r = await mount();
    await flush();
    // The list is virtualised, so choose the category that contains the service first.
    await press(r, 'category-chip-barber');
    const classic = CUSTOMER_SERVICE_CATEGORIES.flatMap((c) => c.services).find((s) => s.id === 'classic-haircut')!;
    await press(r, `service-card-${classic.id}`);
    expect(navigation.navigate).toHaveBeenCalledTimes(1);
    const [tab, params] = navigation.navigate.mock.calls[0];
    expect(tab).toBe('SearchTab');
    expect(params).toMatchObject({ screen: 'SalonSearch', params: { initialQuery: 'Classic Haircut' } });
    expect(typeof params.params.searchNonce).toBe('number');
  });

  it('carries no price anywhere on the screen', async () => {
    const r = await mount();
    await flush();
    expect(allText(r)).not.toMatch(/₹|\bINR\b|price/i);
  });

  it('every card has an accessible "find shops offering" label and a photo from the editorial library', async () => {
    const r = await mount();
    await flush();
    await press(r, 'category-chip-barber');
    const card = byTestId(r, 'service-card-classic-haircut')[0];
    expect(card.props.accessibilityLabel).toBe(t.allServicesFindShopsFor.replace('{service}', 'Classic Haircut'));
    const images = r.root.findAll((n: { props: Record<string, unknown> }) => {
      const source = n.props.source as { uri?: string } | undefined;
      return typeof source?.uri === 'string' && source.uri.startsWith('https://fastque.com/editorial/services/');
    });
    expect(images.length).toBeGreaterThan(0);
  });

  it('works in Hindi labels via the same strings (title, note and filter placeholder exist and differ)', () => {
    const hi = uiStringsFor('HI');
    for (const key of ['allServicesTitle', 'allServicesNote', 'allServicesSearchPlaceholder', 'allServicesNoMatch'] as const) {
      expect(hi[key]).toBeTruthy();
      expect(hi[key]).not.toBe(t[key]);
    }
  });
});

describe('All Services for signed-out visitors', () => {
  it('a service opens the GUEST shop search (browse first, sign in last), carrying the keyword', async () => {
    mockGuestNavigate.mockClear();
    const r = await render(createElement(GuestAllServicesScreen as never));
    await flush();
    await press(r, 'category-chip-barber');
    await press(r, 'service-card-classic-haircut');
    expect(mockGuestNavigate).toHaveBeenCalledTimes(1);
    const [route, params] = mockGuestNavigate.mock.calls[0];
    expect(route).toBe('GuestBrowse');
    expect(params).toMatchObject({ screen: 'SalonSearch', params: { initialQuery: 'Classic Haircut' } });
  });
});

describe('buildRows', () => {
  it('emits one banner per category then two cards per row, never an empty row', () => {
    const rows = buildRows(CUSTOMER_SERVICE_CATEGORIES);
    const banners = rows.filter((row) => row.kind === 'category');
    expect(banners).toHaveLength(CUSTOMER_SERVICE_CATEGORIES.length);
    for (const row of rows) if (row.kind === 'cards') expect(row.items.length).toBeGreaterThan(0), expect(row.items.length).toBeLessThanOrEqual(2);
    const cards = rows.flatMap((row) => (row.kind === 'cards' ? row.items : []));
    expect(cards).toHaveLength(CUSTOMER_SERVICE_CATEGORIES.flatMap((c) => c.services).length);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });

  it('is empty when nothing is visible', () => {
    expect(buildRows([])).toEqual([]);
  });
});

// silence unused import in environments where act is not needed by the cases above
void act;
