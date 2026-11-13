/// <reference types="jest" />
import { act, createElement } from 'react';
import TestRenderer from 'react-test-renderer';
import { OwnerLiveAlerts } from '../OwnerLiveAlerts';
import { __resetBookingVoiceDedupeForTests, claimBookingVoiceEvent } from '../../../lib/booking-voice-dedupe';

const handlers: Record<string, (payload: unknown) => void> = {};
const mockSpeak = jest.fn();
const mockApiFetch = jest.fn();
const mockNavigate = jest.fn();
let mockRoute = 'OwnerDashboardTab';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 0 }) }));
jest.mock('../../../lib/api', () => ({ apiFetch: (...args: unknown[]) => mockApiFetch(...args) }));
jest.mock('../../../lib/salon-context', () => ({ useSalon: () => ({ selectedSalonId: 's1' }) }));
jest.mock('../../../lib/language-context', () => ({ useLanguage: () => ({ language: 'EN' }) }));
jest.mock('../../../lib/voice-announce', () => ({ speakBooking: (...args: unknown[]) => mockSpeak(...args) }));
jest.mock('../../../lib/realtime', () => ({
  getRealtimeSocket: () => ({
    on: (event: string, cb: (payload: unknown) => void) => { handlers[event] = cb; },
    off: (event: string) => { delete handlers[event]; },
  }),
  joinSalonRoom: jest.fn(),
}));
jest.mock('../../../navigation/navigation-ref', () => ({
  navigationRef: {
    isReady: () => true,
    getCurrentRoute: () => ({ name: mockRoute }),
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
}));

type Rendered = ReturnType<typeof TestRenderer.create>;
async function mount(): Promise<Rendered> {
  let tree!: Rendered;
  await act(async () => { tree = TestRenderer.create(createElement(OwnerLiveAlerts)); });
  return tree;
}
const banners = (tree: Rendered) => tree.root.findAll((n: { props: Record<string, unknown>; type: unknown }) => n.props.testID === 'owner-live-alert' && typeof n.props.onPress === 'function' && typeof n.type !== 'string');
const bannerText = (tree: Rendered) => banners(tree).map((n: { props: Record<string, unknown>; type: unknown }) => n.props.accessibilityLabel);

beforeEach(() => {
  __resetBookingVoiceDedupeForTests();
  mockSpeak.mockReset();
  mockApiFetch.mockReset();
  mockNavigate.mockReset();
  mockRoute = 'OwnerDashboardTab';
});

describe('OwnerLiveAlerts — alerts on every owner screen (owner report, 13 Nov)', () => {
  it('announces a Live Queue join from any screen, once, and opens the queue on tap', async () => {
    const tree = await mount();
    await act(async () => handlers['queue.entry.joined']({ salonId: 's1', queueEntryId: 'q1', tokenNumber: 7, serviceName: 'Haircut' }));
    expect(bannerText(tree)).toEqual(['New customer in Live Queue #7 · Haircut']);
    expect(mockSpeak).toHaveBeenCalledWith(expect.objectContaining({ event: 'queue.joined', tokenNumber: 7, serviceName: 'Haircut' }));
    await act(async () => handlers['queue.entry.joined']({ salonId: 's1', queueEntryId: 'q1', tokenNumber: 7, serviceName: 'Haircut' }));
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    await act(async () => (banners(tree)[0].props.onPress as () => void)());
    expect(mockNavigate).toHaveBeenCalledWith('OwnerQueueTab');
    await act(async () => tree.unmount());
  });

  it('ignores another shop', async () => {
    const tree = await mount();
    await act(async () => handlers['queue.entry.joined']({ salonId: 'other', queueEntryId: 'q2', tokenNumber: 1 }));
    expect(bannerText(tree)).toEqual([]);
    expect(mockSpeak).not.toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it('announces a new booking off the Bookings screen', async () => {
    mockApiFetch.mockResolvedValue({ serviceName: 'Beard Trim', salonName: 'Handsome Center', slotStart: null, salonTimezone: null, assignedStaffName: null, preferredStaffName: null });
    const tree = await mount();
    await act(async () => { handlers['booking.created']({ salonId: 's1', bookingId: 'b1' }); });
    expect(bannerText(tree)).toEqual(['New booking · Beard Trim']);
    expect(mockSpeak).toHaveBeenCalledWith(expect.objectContaining({ event: 'booking.created', bookingId: 'b1', serviceName: 'Beard Trim' }));
    await act(async () => tree.unmount());
  });

  it('never speaks a booking the Bookings screen already announced, and leaves its toast to that screen', async () => {
    mockRoute = 'OwnerBookingsTab';
    mockApiFetch.mockResolvedValue({ serviceName: 'Fade', slotStart: null });
    claimBookingVoiceEvent('booking.created', 'b2');
    const tree = await mount();
    await act(async () => { handlers['booking.created']({ salonId: 's1', bookingId: 'b2' }); });
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(bannerText(tree)).toEqual([]);
    await act(async () => tree.unmount());
  });
});
