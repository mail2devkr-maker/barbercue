import {
  HOME_FLAG_NAMES,
  type HomeFlagName,
  type HomeFlags,
} from '@barbercue/shared';

/**
 * FastQue Home switches, read per request. Everything is OFF unless the variable is exactly "true".
 * Every flag also needs FASTQUE_HOME_ENABLED. Flags gate NEW business only: bookings that already
 * exist can always be viewed, completed, cancelled and resolved.
 *
 * Optional road routing (no paid service is used by default):
 *   HOME_ROUTING_PROVIDER=osrm + HOME_OSRM_BASE_URL=https://your-own-osrm
 */
export function homeFlag(name: HomeFlagName): boolean {
  const on = process.env[name] === 'true';
  if (name === 'FASTQUE_HOME_ENABLED') return on;
  return on && process.env.FASTQUE_HOME_ENABLED === 'true';
}

export function homeFlags(): HomeFlags {
  return Object.fromEntries(
    HOME_FLAG_NAMES.map((n) => [n, homeFlag(n)]),
  ) as HomeFlags;
}

export function providerKindEnabled(
  kind: 'SALON_MANAGED' | 'INDEPENDENT_PROFESSIONAL',
): boolean {
  return homeFlag(
    kind === 'SALON_MANAGED'
      ? 'SALON_HOME_SERVICES_ENABLED'
      : 'FREELANCER_HOME_SERVICES_ENABLED',
  );
}
