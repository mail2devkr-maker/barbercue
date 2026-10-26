/// <reference types="jest" />
import {
  isPasswordChangeRequired,
  notifyPasswordChangeRequired,
  passwordChangeUrl,
  subscribePasswordChangeRequired,
} from '../password-change-gate';

describe('password change gate (owner transfer, Android handoff)', () => {
  it('recognises only a 403 with the PASSWORD_CHANGE_REQUIRED code', () => {
    expect(isPasswordChangeRequired(403, 'PASSWORD_CHANGE_REQUIRED')).toBe(true);
    expect(isPasswordChangeRequired(401, 'PASSWORD_CHANGE_REQUIRED')).toBe(false);
    expect(isPasswordChangeRequired(403, 'FORBIDDEN')).toBe(false);
    expect(isPasswordChangeRequired(500, undefined)).toBe(false);
  });

  it('tells every subscriber once per notification, and stops after unsubscribe', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = subscribePasswordChangeRequired(a);
    subscribePasswordChangeRequired(b)();
    notifyPasswordChangeRequired();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    offA();
    notifyPasswordChangeRequired();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('builds the website change-password address without double slashes', () => {
    expect(passwordChangeUrl('https://fastque.com')).toBe('https://fastque.com/change-password-required');
    expect(passwordChangeUrl('https://fastque.com///')).toBe('https://fastque.com/change-password-required');
  });
});
