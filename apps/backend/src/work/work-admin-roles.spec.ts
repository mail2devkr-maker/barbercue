import { Role } from '@barbercue/shared';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { WorkAdminController } from './work-admin.controller';

/**
 * Junior admin (WORK_REVIEWER) must be able to take exactly the three low-risk review decisions and
 * nothing else that writes: no money, payouts, disputes, suspensions or sweeps.
 */
describe('WorkAdminController role map', () => {
  const proto = WorkAdminController.prototype as unknown as Record<
    string,
    unknown
  >;
  const rolesOf = (name: string): Role[] =>
    (Reflect.getMetadata(ROLES_KEY, proto[name] as object) as Role[]) ?? [];
  const methods = Object.getOwnPropertyNames(proto).filter(
    (n) => n !== 'constructor' && typeof proto[n] === 'function',
  );

  it('allows the reviewer on the three review routes only', () => {
    const reviewer = methods
      .filter((n) => rolesOf(n).includes(Role.WORK_REVIEWER))
      .map((n) => rolesOf(n).join(','));
    expect(reviewer).toHaveLength(3);
    for (const r of reviewer) expect(r).toBe('PLATFORM_ADMIN,WORK_REVIEWER');
  });

  it('keeps every other write route PLATFORM_ADMIN only', () => {
    const adminOnly = methods.filter(
      (n) => rolesOf(n).length > 0 && !rolesOf(n).includes(Role.WORK_REVIEWER),
    );
    for (const n of adminOnly) expect(rolesOf(n)).toEqual([Role.PLATFORM_ADMIN]);
    for (const n of [
      'confirmManualFunding',
      'confirmManualPayout',
      'neftExport',
    ])
      expect(rolesOf(n)).toEqual([Role.PLATFORM_ADMIN]);
  });
});
