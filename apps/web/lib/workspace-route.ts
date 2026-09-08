import { Role, type MeResponse } from "@barbercue/shared";

/** Route from roles returned by the server, never from which login button the user clicked. */
export function workspaceLandingPath(user: MeResponse): string {
  if (user.roles.includes(Role.PLATFORM_ADMIN)) return "/dashboard/admin";
  if (user.roles.includes(Role.SALON_OWNER) || user.roles.includes(Role.SALON_STAFF)) {
    return "/dashboard/salons";
  }
  return "/account/bookings";
}

/** True when the current session belongs to an operational workspace rather than a customer account. */
export function isWorkspaceUser(user: MeResponse): boolean {
  return user.roles.some((role) =>
    role === Role.PLATFORM_ADMIN || role === Role.SALON_OWNER || role === Role.SALON_STAFF,
  );
}

/** Keep public navigation labels aligned with the role-scoped destination we actually expose. */
export function workspaceNavigationLabel(user: MeResponse): string {
  if (user.roles.includes(Role.PLATFORM_ADMIN)) return "Admin dashboard";
  if (user.roles.includes(Role.SALON_OWNER)) return "Owner dashboard";
  if (user.roles.includes(Role.SALON_STAFF)) return "Back to dashboard";
  return "My account";
}
