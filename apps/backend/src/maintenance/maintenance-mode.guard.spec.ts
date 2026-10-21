import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { MaintenanceModeGuard } from './maintenance-mode.guard';
import { MaintenanceModeService } from './maintenance-mode.service';

describe('MaintenanceModeGuard', () => {
  const makeContext = (method: string) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => ({ method }) }),
    }) as ExecutionContext;

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'allows %s for status and read-only access',
    (method) => {
      const guard = new MaintenanceModeGuard({
        isEnabled: () => true,
      } as MaintenanceModeService);
      expect(guard.canActivate(makeContext(method))).toBe(true);
    },
  );

  it('returns stable 503 maintenance error for mutation methods', () => {
    const guard = new MaintenanceModeGuard({
      isEnabled: () => true,
      getStatus: () => ({ enabled: true, message: 'Scheduled window.' }),
    } as MaintenanceModeService);
    try {
      guard.canActivate(makeContext('POST'));
      throw new Error('Expected maintenance rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(error).toMatchObject({
        code: 'MAINTENANCE_MODE',
        status: HttpStatus.SERVICE_UNAVAILABLE,
      });
    }
  });

  it('allows all routes when the flag is off', () => {
    const guard = new MaintenanceModeGuard({
      isEnabled: () => false,
    } as MaintenanceModeService);
    expect(guard.canActivate(makeContext('POST'))).toBe(true);
  });

  it('leaves non-HTTP transports intact; Prisma remains the database write barrier', () => {
    const guard = new MaintenanceModeGuard({
      isEnabled: () => true,
    } as MaintenanceModeService);
    const context = {
      getType: () => 'ws',
      switchToHttp: () => ({ getRequest: () => undefined }),
    } as unknown as ExecutionContext;

    expect(guard.canActivate(context)).toBe(true);
  });
});
