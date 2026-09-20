/// <reference types="jest" />
import * as Notifications from 'expo-notifications';
import { Language } from '@barbercue/shared';
import { alertArrivalOnce, clearArrivalAlerted, __resetArrivalAlertsForTests } from '../arrival-alert-sound';
import { canSpeak, speakBooking } from '../voice-announce';

// The arrival check must be SPOKEN (as the new-booking announcement is), through the same speakBooking
// pipeline, and speech must REPLACE the tone: exactly one audible thing per episode. Only when speech is
// impossible does it fall back to the tone - the alert is never silent.
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('../push-notifications', () => ({ ANDROID_BOOKING_CHANNEL_ID: 'booking-updates' }));
jest.mock('../voice-announce', () => ({ canSpeak: jest.fn(), speakBooking: jest.fn() }));

const input = (bookingId = 'b1') => ({
  bookingId,
  salonId: 's1',
  title: 'Appointment arrival check',
  body: '6:30 PM · Haircut · Has the customer arrived?',
  voice: { language: Language.EN, serviceName: 'Haircut', time: '6:30 PM' },
});
const tones = () => (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.length;

beforeEach(() => {
  jest.clearAllMocks();
  __resetArrivalAlertsForTests();
  (canSpeak as jest.Mock).mockResolvedValue(true);
});

it('speaks the arrival announcement through speakBooking with the service and time - and plays NO tone', async () => {
  await expect(alertArrivalOnce(input())).resolves.toBe(true);
  expect(speakBooking).toHaveBeenCalledTimes(1);
  expect(speakBooking).toHaveBeenCalledWith({
    event: 'booking.arrival_check',
    bookingId: 'b1',
    language: Language.EN,
    serviceName: 'Haircut',
    time: '6:30 PM',
  });
  expect(tones()).toBe(0);
});

it('speaks in the owners language (Hindi)', async () => {
  await alertArrivalOnce({ ...input(), voice: { language: Language.HI, serviceName: 'Haircut', time: '6:30 PM' } });
  expect(canSpeak).toHaveBeenCalledWith(Language.HI);
  expect(speakBooking).toHaveBeenCalledWith(expect.objectContaining({ language: Language.HI }));
});

it('falls back to the tone - never silence - when speech is impossible on this phone', async () => {
  (canSpeak as jest.Mock).mockResolvedValue(false);
  await alertArrivalOnce(input());
  expect(speakBooking).not.toHaveBeenCalled();
  expect(tones()).toBe(1);
});

it('falls back to the tone when the speech check itself throws', async () => {
  (canSpeak as jest.Mock).mockRejectedValue(new Error('tts service died'));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  await alertArrivalOnce(input());
  expect(speakBooking).not.toHaveBeenCalled();
  expect(tones()).toBe(1);
});

it('is exactly once per episode: a duplicate push / realtime / refresh / reconcile never speaks or rings again', async () => {
  await alertArrivalOnce(input());
  await alertArrivalOnce(input());
  await alertArrivalOnce(input());
  expect(speakBooking).toHaveBeenCalledTimes(1);
  expect(tones()).toBe(0);
});

it('a new episode (snooze re-armed) speaks exactly once more', async () => {
  await alertArrivalOnce(input());
  clearArrivalAlerted('b1');
  await alertArrivalOnce(input());
  await alertArrivalOnce(input());
  expect(speakBooking).toHaveBeenCalledTimes(2);
});

it('without a voice request it behaves exactly as before: the tone only', async () => {
  const plain = { bookingId: 'b1', salonId: 's1', title: 't', body: 'b' };
  await alertArrivalOnce(plain);
  expect(canSpeak).not.toHaveBeenCalled();
  expect(tones()).toBe(1);
});

it('different bookings each get their own single announcement', async () => {
  await alertArrivalOnce(input('b1'));
  await alertArrivalOnce(input('b2'));
  expect(speakBooking).toHaveBeenCalledTimes(2);
});
