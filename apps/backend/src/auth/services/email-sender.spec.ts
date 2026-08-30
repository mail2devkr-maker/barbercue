import { AuthErrorCode } from '@barbercue/shared';
import {
  ConsoleEmailSender,
  UnavailableProductionEmailSender,
} from './email-sender';

describe('EmailSender transports', () => {
  it('keeps deterministic development capture available for reset and invitation tests', async () => {
    const sender = new ConsoleEmailSender();
    expect(() => sender.assertAvailable()).not.toThrow();
    await expect(
      sender.sendPasswordReset('owner@example.com', 'http://localhost/reset', 15),
    ).resolves.toBeUndefined();
    await expect(
      sender.sendStaffInvitation('staff@example.com', 'http://localhost/invite', 7),
    ).resolves.toBeUndefined();
  });

  it('never silently reports production delivery when no transport is bound', () => {
    const sender = new UnavailableProductionEmailSender();
    expect(() => sender.assertAvailable()).toThrow(
      expect.objectContaining({ code: AuthErrorCode.EMAIL_DELIVERY_UNAVAILABLE }),
    );
  });
});
