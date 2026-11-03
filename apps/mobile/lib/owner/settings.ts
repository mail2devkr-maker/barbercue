import {
  ChairStatus,
  SalonSetupErrorCode,
  StaffMemberStatus,
  type SalonChairDto,
  type SalonServiceDto,
  type SalonSetupReadinessDto,
  type SalonStaffDto,
  type UiStrings,
} from '@barbercue/shared';

/**
 * Pure rules for the owner Settings screen, kept identical to the website's: what "ready to open"
 * means, how a rejected activation's details are read, and which time zones can be chosen.
 */

/** The backend's own activation gate: an ACTIVE service, an ACTIVE chair and an ACTIVE barber. */
export function computeReadiness(
  services: readonly Pick<SalonServiceDto, 'isActive'>[],
  chairs: readonly Pick<SalonChairDto, 'status'>[],
  staff: readonly Pick<SalonStaffDto, 'status'>[],
): SalonSetupReadinessDto {
  return {
    hasActiveService: services.some((service) => service.isActive),
    hasActiveChair: chairs.some((chair) => chair.status === ChairStatus.ACTIVE),
    hasActiveStaff: staff.some((member) => member.status === StaffMemberStatus.ACTIVE),
  };
}

export function isReady(readiness: SalonSetupReadinessDto): boolean {
  return readiness.hasActiveService && readiness.hasActiveChair && readiness.hasActiveStaff;
}

/**
 * The server sends readiness as the `details` of a SALON_SETUP_INCOMPLETE error. It arrives as
 * `unknown`, so it is narrowed rather than cast: a malformed payload returns null and leaves the
 * locally computed readiness alone instead of blanking the checklist.
 */
export function readinessFromDetails(details: unknown): SalonSetupReadinessDto | null {
  if (typeof details !== 'object' || details === null) return null;
  const d = details as Record<string, unknown>;
  if (typeof d.hasActiveService !== 'boolean' || typeof d.hasActiveChair !== 'boolean' || typeof d.hasActiveStaff !== 'boolean') {
    return null;
  }
  return { hasActiveService: d.hasActiveService, hasActiveChair: d.hasActiveChair, hasActiveStaff: d.hasActiveStaff };
}

export function isSetupIncomplete(code: string | undefined): boolean {
  return code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE;
}

export function statusLabel(status: string, closedForToday: boolean, t: UiStrings): string {
  if (status === 'ACTIVE' && closedForToday) return t.shopStatusClosedToday;
  switch (status) {
    case 'ACTIVE':
      return t.shopStatusOpen;
    case 'SUSPENDED':
      return t.shopStatusPaused;
    default:
      return t.shopStatusNotOpen;
  }
}

// ---------- time zones ----------

/** Mirrors updateSalonTimezoneSchema's shape check (the server's Intl check remains the authority). */
export const IANA_SHAPE = /^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+\-/]+$/;

/** Used when the runtime cannot enumerate zones. Covers the common ones; any stored zone is added. */
const COMMON_ZONES = [
  'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Kathmandu', 'Asia/Colombo', 'Asia/Karachi', 'Asia/Kabul', 'Asia/Dubai', 'Asia/Muscat',
  'Asia/Riyadh', 'Asia/Qatar', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Tehran', 'Asia/Baghdad', 'Asia/Jerusalem', 'Asia/Istanbul',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila', 'Asia/Ho_Chi_Minh', 'Asia/Hong_Kong',
  'Asia/Shanghai', 'Asia/Taipei', 'Asia/Seoul', 'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney', 'Australia/Melbourne',
  'Pacific/Auckland', 'Africa/Cairo', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Casablanca',
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome',
  'Europe/Amsterdam', 'Europe/Zurich', 'Europe/Stockholm', 'Europe/Athens', 'Europe/Kyiv', 'Europe/Moscow',
  'America/St_Johns', 'America/Halifax', 'America/New_York', 'America/Toronto', 'America/Chicago', 'America/Denver',
  'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Mexico_City', 'America/Bogota',
  'America/Lima', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'America/Santiago', 'UTC',
];

type IntlWithSupportedValues = typeof Intl & { supportedValuesOf?: (key: string) => string[] };

/**
 * Selectable IANA zones. Asia/Kolkata is always present even when the runtime's canonical list only
 * knows the older Asia/Calcutta alias (the codebase uses Asia/Kolkata everywhere), and whatever zone
 * the shop already stores stays selectable even if it is unusual, so loading the screen never
 * pre-selects nothing.
 */
export function supportedTimeZones(current: string | null, intl: IntlWithSupportedValues = Intl as IntlWithSupportedValues): string[] {
  let zones: string[] = [];
  try {
    zones = typeof intl.supportedValuesOf === 'function' ? intl.supportedValuesOf('timeZone') : [];
  } catch {
    zones = [];
  }
  if (zones.length === 0) zones = COMMON_ZONES;
  const list = zones.includes('Asia/Kolkata') ? [...zones] : ['Asia/Kolkata', ...zones];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

/** Case-insensitive match where spaces, slashes and underscores are interchangeable ("new york"). */
export function filterTimeZones(zones: readonly string[], query: string, limit = 40): string[] {
  const norm = (value: string) => value.toLowerCase().replace(/[\s/_-]+/g, ' ').trim();
  const needle = norm(query);
  const matches = needle ? zones.filter((zone) => norm(zone).includes(needle)) : [...zones];
  return matches.slice(0, limit);
}
