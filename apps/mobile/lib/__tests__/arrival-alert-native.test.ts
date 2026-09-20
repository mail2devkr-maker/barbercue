/// <reference types="jest" />
import { Language } from '@barbercue/shared';

// The native module is either present (an Android binary built with it) or absent (iOS, web, or an
// older binary receiving this JS over the air). Both must be safe.
const mockModule = {
  getReadiness: jest.fn(),
  openFullScreenIntentSettings: jest.fn(),
  openNotificationSettings: jest.fn(),
  openArrivalChannelSettings: jest.fn(),
  dismissNotification: jest.fn(),
  cancelAlert: jest.fn(),
  scheduleSnooze: jest.fn(),
  reconcile: jest.fn(),
  getNativeState: jest.fn(),
};
let mockAvailable = true;
jest.mock('expo', () => ({
  requireOptionalNativeModule: () => (mockAvailable ? mockModule : null),
}));

function load(platform: 'android' | 'ios', available: boolean) {
  jest.resetModules();
  mockAvailable = available;
  jest.doMock('react-native', () => ({ Platform: { OS: platform } }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../arrival-alert-native') as typeof import('../arrival-alert-native');
}

beforeEach(() => {
  Object.values(mockModule).forEach((fn) => fn.mockReset());
});

describe('without the native module (iOS, or an older Android binary)', () => {
  it.each([
    ['iOS', 'ios', true],
    ['an Android binary that predates the module', 'android', false],
  ] as const)('%s: every call is a harmless no-op', (_label, platform, available) => {
    const native = load(platform, available);
    expect(native.isNativeArrivalAlertAvailable()).toBe(false);
    expect(native.getArrivalAlertReadiness()).toBeNull();
    expect(native.readNativeArrivalState()).toEqual({ alerted: [], snoozes: {} });
    expect(() => {
      native.openFullScreenIntentSettings();
      native.openArrivalNotificationSettings();
      native.dismissNativeArrivalNotification('b1');
      native.cancelNativeArrivalAlert('b1');
      native.reconcileNativeArrivalAlerts('s1', ['b1']);
      native.scheduleNativeArrivalSnooze(
        { salonId: 's1', bookingId: 'b1', slotStart: '2026-09-21T10:00:00.000Z', serviceName: 'Haircut' },
        Language.EN,
      );
    }).not.toThrow();
    expect(mockModule.cancelAlert).not.toHaveBeenCalled();
  });
});

describe('with the native module', () => {
  it('reports readiness', () => {
    const native = load('android', true);
    mockModule.getReadiness.mockReturnValue({
      sdkInt: 34,
      notificationsEnabled: true,
      fullScreenIntentAllowed: false,
      arrivalChannelMuted: true,
      fullScreenIntentNeedsUserGrant: true,
    });
    expect(native.isNativeArrivalAlertAvailable()).toBe(true);
    expect(native.getArrivalAlertReadiness()).toEqual({
      notificationsEnabled: true,
      fullScreenIntentAllowed: false,
      arrivalChannelMuted: true,
      fullScreenIntentNeedsUserGrant: true,
    });
  });

  it('treats a throwing native call as "nothing to set up" rather than crashing the app', () => {
    const native = load('android', true);
    mockModule.getReadiness.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(native.getArrivalAlertReadiness()).toBeNull();
    mockModule.cancelAlert.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => native.cancelNativeArrivalAlert('b1')).not.toThrow();
  });

  it('passes the snooze to the phone with the owner language, IDs and time only', () => {
    const native = load('android', true);
    native.scheduleNativeArrivalSnooze(
      { salonId: 's1', bookingId: 'b1', slotStart: '2026-09-21T10:00:00.000Z', serviceName: 'Haircut' },
      Language.HI,
    );
    expect(mockModule.scheduleSnooze).toHaveBeenCalledWith('s1', 'b1', '2026-09-21T10:00:00.000Z', 'Haircut', 'HI');
  });

  it('forwards reconcile / cancel / dismiss / settings calls', () => {
    const native = load('android', true);
    native.reconcileNativeArrivalAlerts('s1', ['b1', 'b2']);
    native.cancelNativeArrivalAlert('b1');
    native.dismissNativeArrivalNotification('b2');
    native.openFullScreenIntentSettings();
    native.openArrivalNotificationSettings();
    native.openArrivalChannelSettings();
    expect(mockModule.openArrivalChannelSettings).toHaveBeenCalledTimes(1);
    expect(mockModule.reconcile).toHaveBeenCalledWith('s1', ['b1', 'b2']);
    expect(mockModule.cancelAlert).toHaveBeenCalledWith('b1');
    expect(mockModule.dismissNotification).toHaveBeenCalledWith('b2');
    expect(mockModule.openFullScreenIntentSettings).toHaveBeenCalledTimes(1);
    expect(mockModule.openNotificationSettings).toHaveBeenCalledTimes(1);
  });

  it('parses native state and survives garbage', () => {
    const native = load('android', true);
    mockModule.getNativeState.mockReturnValue(JSON.stringify({ alerted: ['b1', 7, 'b2'], snoozes: { b3: 123 } }));
    expect(native.readNativeArrivalState()).toEqual({ alerted: ['b1', 'b2'], snoozes: { b3: 123 } });
    mockModule.getNativeState.mockReturnValue('not json');
    expect(native.readNativeArrivalState()).toEqual({ alerted: [], snoozes: {} });
    mockModule.getNativeState.mockReturnValue('{}');
    expect(native.readNativeArrivalState()).toEqual({ alerted: [], snoozes: {} });
  });
});
