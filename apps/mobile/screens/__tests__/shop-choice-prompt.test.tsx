/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import StaffTodayScreen from '../staff/StaffTodayScreen';
import OwnerDashboardScreen from '../owner/OwnerDashboardScreen';

// A barber or owner with several shops and no remembered one must be told to choose - never see a bare title.
const mockSalon: { current: Record<string, unknown> } = { current: {} };
const mockSelect = jest.fn();
const mockLanguage = { language: 'EN', t: require('@barbercue/shared').uiStringsFor('EN') };
const mockNavigation = { navigate: jest.fn() };

jest.mock('../../lib/salon-context', () => ({ useSalon: () => mockSalon.current }));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => mockLanguage }));
jest.mock('../../lib/notifications', () => ({ useUnreadNotificationCount: () => 0 }));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn(() => new Promise(() => undefined)), ApiError: class extends Error {} }));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useFocusEffect: () => undefined,
}));
jest.mock('../../components/dashboard/LiveQueuePanel', () => ({ LiveQueuePanel: () => null }));
jest.mock('../../components/dashboard/StaffMyDayCard', () => ({ StaffMyDayCard: () => null }));
jest.mock('../../components/owner/OwnerOverviewPanel', () => ({ OwnerOverviewPanel: () => null }));
jest.mock('../../components/ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement: h } = require('react');
  const Box = ({ children }: { children?: unknown }) => h(View, null, children);
  return {
    Screen: Box,
    PremiumScreen: Box,
    PremiumCard: Box,
    SectionHeader: ({ title }: { title: string }) => h(Text, null, title),
    PremiumSectionHeader: ({ title }: { title: string }) => h(Text, null, title),
    Button: ({ title }: { title: string }) => h(Pressable, null, h(Text, null, title)),
    PremiumButton: ({ title }: { title: string }) => h(Pressable, null, h(Text, null, title)),
    EmptyState: ({ title, message }: { title: string; message: string }) => h(View, null, h(Text, null, title), h(Text, null, message)),
    Skeleton: View,
    InlineError: ({ message }: { message: string }) => h(Text, null, message),
    NotificationBell: View,
  };
});

const shops = [
  { id: 'a', name: 'Studio One', status: 'ACTIVE' },
  { id: 'b', name: 'Studio Two', status: 'ACTIVE' },
];
const state = (over: Record<string, unknown>) => ({
  workplaces: shops,
  loading: false,
  error: null,
  selectedSalonId: null,
  selectedSalon: null,
  selectSalon: mockSelect,
  reload: jest.fn(),
  ...over,
});

async function render(element: ReturnType<typeof createElement>): Promise<string> {
  let tree: ReturnType<typeof TestRenderer.create> | undefined;
  await act(async () => {
    tree = TestRenderer.create(element);
  });
  return JSON.stringify(tree!.toJSON());
}

describe('several shops and none remembered: the user is asked to choose', () => {
  it('the barber Today screen shows the shops and a clear instruction', async () => {
    mockSalon.current = state({});
    const out = await render(createElement(StaffTodayScreen));
    expect(out).toContain('Studio One');
    expect(out).toContain('Studio Two');
    expect(out).toContain(mockLanguage.t.selectShopTitle);
    expect(out).toContain(mockLanguage.t.pickShopToContinueHint);
  });

  it('the owner Dashboard shows the same instruction', async () => {
    mockSalon.current = state({});
    const out = await render(createElement(OwnerDashboardScreen));
    expect(out).toContain(mockLanguage.t.selectShopTitle);
    expect(out).toContain(mockLanguage.t.pickShopToContinueHint);
  });

  it('no instruction once a shop is selected', async () => {
    mockSalon.current = state({ selectedSalonId: 'a', selectedSalon: shops[0] });
    expect(await render(createElement(StaffTodayScreen))).not.toContain(mockLanguage.t.pickShopToContinueHint);
    expect(await render(createElement(OwnerDashboardScreen))).not.toContain(mockLanguage.t.pickShopToContinueHint);
  });

  it('the Hindi instruction is translated', () => {
    const hi = require('@barbercue/shared').uiStringsFor('HI');
    expect(hi.pickShopToContinueHint).toMatch(/[ऀ-ॿ]/);
  });
});
