import { Role } from "@barbercue/shared";

/**
 * Permanent chair / staff deletion (#378) is SALON_OWNER or PLATFORM_ADMIN only on the server
 * (permanent-deletion.controller). A Co-Founder managing a shop (#382) must not see a button the
 * server will always refuse. Client affordance only: the server still decides.
 */
export function canPermanentlyDelete(
  roles: readonly Role[] | undefined,
): boolean {
  return (
    !!roles &&
    (roles.includes(Role.SALON_OWNER) || roles.includes(Role.PLATFORM_ADMIN))
  );
}
