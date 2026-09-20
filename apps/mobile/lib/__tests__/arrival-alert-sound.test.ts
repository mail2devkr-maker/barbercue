/// <reference types="jest" />
import * as Notifications from 'expo-notifications';
import { Platform, Vibration } from 'react-native';
import {
  LOCAL_ARRIVAL_ALERT_TYPE,
  __resetArrivalAlertsForTests,
  alertArrivalOnce,
  clearArrivalAlerted,
  foregroundArrivalPushBehavior,
  hasArrivalAlerted,
  localArrivalAlertBehavior,
  markArrivalAlerted,
  pruneArrivalAlerted,
} from '../arrival-alert-sound';

jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(async () => 'local-1'),
  dismissNotificationAsync: jest.fn(async () => undefined),
  AndroidNotificationPriority: { HIGH: 'high' },
}));
jest.mock('../push-notifications', () => ({ ANDROID_BOOKING_CHANNEL_ID: 'booking-updates' }));

const alertInput = { bookingId: 'b1', salonId: 's1', title: 'Appointment arrival check', body: '4:30 pm - Beard' };

beforeEach(() => {
  jest.clearAllMocks();
  __resetArrivalAlertsForTests();
  jest.spyOn(Vibration, 'vibrate').mockImplementation(() => undefined);
  // The owner app this alert targets is the Android build (jest-expo defaults to iOS).
  jest.replaceProperty(Platform, 'OS', 'android');
});
afterEach(() => jest.restoreAllMocks());

describe('alertArrivalOnce', () => {
  it('posts one audible alert on the existing high-importance booking channel, with vibration', async () => {
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.sound).toBe('default');
    expect(arg.content.priority).toBe('high');
    expect(arg.trigger).toEqual({ channelId: 'booking-updates' });
    expect(arg.content.data).toEqual({ type: LOCAL_ARRIVAL_ALERT_TYPE, bookingId: 'b1', salonId: 's1' });
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  it('never re-sounds for the same eligible booking - the 30s safety refresh, reconnects and re-delivered events are silent', async () => {
    await alertArrivalOnce(alertInput);
    for (let i = 0; i < 5; i += 1) await expect(alertArrivalOnce(alertInput)).resolves.toBe(false);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(Vibration.vibrate).toHaveBeenCalledTimes(1);
  });

  it('sounds independently for a different booking', async () => {
    await alertArrivalOnce(alertInput);
    await alertArrivalOnce({ ...alertInput, bookingId: 'b2' });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('may sound again once a snooze expires (the reminder becomes eligible again)', async () => {
    await alertArrivalOnce(alertInput);
    clearArrivalAlerted('b1'); // what the coordinator does when the 2-minute snooze timer fires
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('ends the episode for bookings that are no longer eligible, so a later one may sound', async () => {
    await alertArrivalOnce(alertInput);
    pruneArrivalAlerted([]); // resolved / cancelled / arrived elsewhere
    expect(hasArrivalAlerted('b1')).toBe(false);
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(true);
  });

  it('keeps the episode open for bookings that are still eligible', async () => {
    await alertArrivalOnce(alertInput);
    pruneArrivalAlerted(['b1', 'b9']);
    expect(hasArrivalAlerted('b1')).toBe(true);
  });

  it('degrades to silence, never an exception, when the OS refuses the notification', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error('permission denied'));
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(true);
  });

  it('survives a vibration failure', async () => {
    (Vibration.vibrate as jest.Mock).mockImplementation(() => {
      throw new Error('no vibrator');
    });
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(true);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('auto-dismisses the local alert so it is not left cluttering the tray', async () => {
    jest.useFakeTimers();
    await alertArrivalOnce(alertInput);
    jest.advanceTimersByTime(10_000);
    expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith('local-1');
    jest.useRealTimers();
  });
});

describe('foregroundArrivalPushBehavior - one alert per eligible arrival across push and in-app', () => {
  it('lets the push itself be the audible alert when nothing has sounded yet, and records it', () => {
    expect(foregroundArrivalPushBehavior('b1')).toMatchObject({ shouldPlaySound: true, shouldShowBanner: true });
    expect(hasArrivalAlerted('b1')).toBe(true);
  });

  it('keeps the push silent when the in-app alert already sounded', async () => {
    await alertArrivalOnce(alertInput);
    expect(foregroundArrivalPushBehavior('b1')).toMatchObject({ shouldPlaySound: false, shouldShowBanner: false });
  });

  it('keeps the in-app alert silent when the push already sounded', async () => {
    foregroundArrivalPushBehavior('b1');
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(false);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('is audible for a payload with no booking id rather than swallowing it', () => {
    expect(foregroundArrivalPushBehavior(null).shouldPlaySound).toBe(true);
  });

  it('a user-initiated open (push tap / Notification Center) marks the episode so opening stays silent', async () => {
    markArrivalAlerted('b1');
    await expect(alertArrivalOnce(alertInput)).resolves.toBe(false);
  });
});

describe('localArrivalAlertBehavior', () => {
  it('is a heads-up with sound that is never left in the notification list', () => {
    expect(localArrivalAlertBehavior()).toMatchObject({ shouldPlaySound: true, shouldShowBanner: true, shouldShowList: false });
  });
});
