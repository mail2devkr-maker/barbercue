import { Role, SessionAudience, type MeResponse } from '@barbercue/shared';

export type AuthenticatedDestination = 'owner' | 'staff' | 'employee' | 'customer' | 'restricted';

/** Employee access requires the server's dedicated audience and its single scoped role. */
export function isAuthorizedEmployeeSession(user: Pick<MeResponse, 'audience' | 'roles'>): boolean {
  return user.audience === SessionAudience.EMPLOYEE && Array.isArray(user.roles) && user.roles.length === 1 && user.roles[0] === Role.FIELD_EXECUTIVE;
}

/** Route only to a shell supported by the authenticated roles; unknown roles never become customers. */
export function getAuthenticatedDestination(user: Pick<MeResponse, 'audience' | 'roles'>): AuthenticatedDestination {
  if (user.audience === SessionAudience.EMPLOYEE || user.roles.includes(Role.FIELD_EXECUTIVE)) {
    return isAuthorizedEmployeeSession(user) ? 'employee' : 'restricted';
  }

  if (user.audience === SessionAudience.STAFF) {
    // The backend scopes STAFF sessions to these salon roles only. Fail closed if a malformed
    // session combines them with an unrelated/global role, while preserving the existing owner
    // precedence for a legitimate account that has both salon roles.
    if (user.roles.length === 0 || user.roles.some((role) => role !== Role.SALON_OWNER && role !== Role.SALON_STAFF)) {
      return 'restricted';
    }
    if (user.roles.includes(Role.SALON_OWNER)) return 'owner';
    if (user.roles.includes(Role.SALON_STAFF)) return 'staff';
    return 'restricted';
  }

  if (user.audience === SessionAudience.CUSTOMER && user.roles.length === 1 && user.roles[0] === Role.CUSTOMER) return 'customer';
  return 'restricted';
}
