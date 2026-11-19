import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import CustomerDashboardScreen from '../CustomerDashboardScreen';
import { apiFetch } from '../../lib/api';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
  useFocusEffect: (effect: () => void) => require('react').useEffect(effect, []),
}));
jest.mock('../../lib/api', () => ({ apiFetch: jest.fn() }));
jest.mock('../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN', t: {} }) }));
jest.mock('../../lib/feature-flags', () => ({ isCreditsEnabled: () => false }));
jest.mock('../../components/QueueStatusPanel', () => ({
  QueueStatusPanel: () => require('react').createElement(require('react-native').Text, null, 'QUEUE-PANEL'),
}));
jest.mock('../../components/ui', () => {
  const { View, Text, Pressable } = require('react-native');
  const { createElement: h } = require('react');
  return {
    Screen: ({ children }: { children: unknown }) => h(View, null, children),
    SectionHeader: ({ title }: { title: string }) => h(Text, null, title),
    Card: ({ children }: { children: unknown }) => h(View, null, children),
    Skeleton: () => h(View, { testID: 'skeleton' }),
    SafeImage: () => h(View, null),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) => h(Pressable, { accessibilityRole: 'button', accessibilityLabel: title, onPress }, h(Text, null, title)),
  };
});

const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
const booking = {
  id: 'b1', status: 'CONFIRMED', slotStart: future, salonName: 'Handsome Center', salonTimezone: 'Asia/Kolkata',
  serviceName: 'Haircut', services: [{ name: 'Haircut' }], preferredStaffName: 'Devon', payableAmount: 300, currency: 'INR',
  salonLat: 25.7, salonLng: 85.2, salonAddress: 'Hajipur',
};
const recent = [{ id: 's1', name: 'Kreative Unisex Salon', slug: 'kreative', citySlug: 'noida', countryCode: 'IN', coverPhotoUrl: null, viewedAt: new Date().toISOString() }];
const review = [{ id: 'r1', salonName: 'Sakhi Beauty', rating: 4, comment: 'Great', ownerResponse: null }];
const notes = { items: [{ id: 'n1', type: 'booking.confirmed', readAt: null, createdAt: new Date().toISOString() }] };

function routes(overrides: Record<string, () => unknown> = {}) {
  (apiFetch as jest.Mock).mockImplementation((path: string) => {
    for (const [key, fn] of Object.entries(overrides)) if (path.includes(key)) return Promise.resolve().then(fn);
    if (path.includes('queue-entries/mine/active')) return Promise.resolve(null);
    if (path.includes('bookings/mine')) return Promise.resolve({ items: [booking], nextCursor: null });
    if (path.includes('recently-viewed')) return Promise.resolve(recent);
    if (path.includes('reviews/mine')) return Promise.resolve(review);
    if (path.includes('notifications')) return Promise.resolve(notes);
    return Promise.reject(new Error('unexpected ' + path));
  });
}

describe('CustomerDashboardScreen (mobile parity with the website dashboard)', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('shows next appointment, recently viewed, my reviews and recent activity', async () => {
    routes();
    await render(<CustomerDashboardScreen />);
    await waitFor(() => expect(screen.getByText('Handsome Center')).toBeTruthy());
    expect(screen.getByText('Haircut')).toBeTruthy();
    expect(screen.getByText('Kreative Unisex Salon')).toBeTruthy();
    expect(screen.getByText('Sakhi Beauty')).toBeTruthy();
    expect(screen.getByText('★★★★☆')).toBeTruthy();
    expect(screen.getByText('Book an Appointment')).toBeTruthy();
    expect(screen.queryByText('My Rewards')).toBeNull(); // credits are release-gated off
  });

  it('one failing request never blanks the other cards', async () => {
    routes({ 'bookings/mine': () => { throw new Error('boom'); } });
    await render(<CustomerDashboardScreen />);
    await waitFor(() => expect(screen.getByText("Couldn't load your appointments.")).toBeTruthy());
    expect(screen.getByText('Kreative Unisex Salon')).toBeTruthy();
    expect(screen.getByText('Sakhi Beauty')).toBeTruthy();
  });

  it('shows the live queue panel only when the customer is in a queue', async () => {
    routes({ 'queue-entries/mine/active': () => ({ id: 'q1', tokenNumber: 7 }) });
    await render(<CustomerDashboardScreen />);
    await waitFor(() => expect(screen.getByText('QUEUE-PANEL')).toBeTruthy());
  });

  it('shows friendly empty states for a brand-new customer', async () => {
    routes({
      'bookings/mine': () => ({ items: [], nextCursor: null }),
      'recently-viewed': () => [],
      'reviews/mine': () => [],
      notifications: () => ({ items: [] }),
    });
    await render(<CustomerDashboardScreen />);
    await waitFor(() => expect(screen.getByText('Your next great look is waiting.')).toBeTruthy());
    expect(screen.getByText('Salons you look at will show up here.')).toBeTruthy();
    expect(screen.getByText('After a visit is completed you can review the salon.')).toBeTruthy();
    expect(screen.getByText('Booking updates, queue alerts and credits will show up here.')).toBeTruthy();
  });

  it('opens the right screens from the cards', async () => {
    routes();
    await render(<CustomerDashboardScreen />);
    await waitFor(() => expect(screen.getByText('Kreative Unisex Salon')).toBeTruthy());
    await fireEvent.press(screen.getByLabelText('All recently viewed'));
    // The dashboard is now also the customer's first tab, so links go through the Account tab.
    expect(mockNavigate).toHaveBeenCalledWith('AccountTab', { screen: 'RecentlyViewed', initial: false });
    await fireEvent.press(screen.getByLabelText('All reviews'));
    // The dashboard is now also the customer's first tab, so links go through the Account tab.
    expect(mockNavigate).toHaveBeenCalledWith('AccountTab', { screen: 'MyReviews', initial: false });
    await fireEvent.press(screen.getByLabelText('Kreative Unisex Salon'));
    expect(mockNavigate).toHaveBeenCalledWith('SearchTab', { screen: 'SalonProfile', params: { countryCode: 'IN', citySlug: 'noida', salonSlug: 'kreative' }, initial: false });
    await fireEvent.press(screen.getByLabelText('Book an Appointment'));
    expect(mockNavigate).toHaveBeenCalledWith('SearchTab', { screen: 'SalonSearch', initial: false });
  });
});
