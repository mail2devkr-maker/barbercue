import { Role, type MeResponse } from "@barbercue/shared";

/** Route from roles returned by the server, never from which login button the user clicked. */
export function workspaceLandingPath(user: MeResponse): string {
  if (user.roles.includes(Role.PLATFORM_ADMIN)) return "/dashboard/admin";
  if (user.roles.includes(Role.SALON_OWNER) || user.roles.includes(Role.SALON_STAFF)) {
    return "/dashboard/salons";
  }
  return "/account/bookings";
}
