import type {
  BookingSource,
  BookingStatus,
  ChargeType,
  PhotoType,
  PrepaymentRequirement,
  QueueEntrySource,
  QueueEntryStatus,
  Role,
} from '../enums';

// DTO shapes only — no I/O, no ORM types leak here. These mirror DATABASE.md/API.md and are the
// contract both apps/web and apps/mobile code against; the backend is the source of truth for
// validation (via the zod schemas in ../schemas), not these types alone.

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
}

// GET /auth/me response — deliberately does not include salon associations (ARCHITECTURE.md §4:
// the JWT itself never carries them, and neither does this convenience endpoint's shape).
export interface MeResponse extends AuthenticatedUser {
  phone: string | null;
  email: string | null;
}

export interface AuthTokens {
  accessToken: string;
  // Present in the response body for mobile (stored via secure storage); web instead relies on
  // the httpOnly refresh cookie the same response sets, per ARCHITECTURE.md §4 — but the field is
  // always present in the JSON shape so one client type serves both.
  refreshToken: string;
  expiresIn: number; // seconds
}

export interface AuthSession {
  id: string;
  deviceInfo: string | null;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface SalonSummary {
  id: string;
  name: string;
  slug: string;
  citySlug: string;
  localitySlug?: string;
  addressLine: string;
  lat: number;
  lng: number;
}

export interface ServiceDto {
  id: string;
  salonId: string;
  name: string;
  durationMinutes: number;
  price: number;
  category: string;
  isActive: boolean;
}

// ---------- Discovery / SEO (Phase 3A) ----------

export interface CityDto {
  id: string;
  name: string;
  slug: string;
  state: string;
  country: string;
}

export interface LocalityDto {
  id: string;
  name: string;
  slug: string;
  citySlug: string;
}

export interface OperatingHoursDto {
  dayOfWeek: number; // 0 = Sunday .. 6 = Saturday (JS Date.getDay() convention)
  openTime: string; // "HH:mm"
  closeTime: string; // "HH:mm"
  isClosed: boolean;
}

export interface PhotoDto {
  id: string;
  url: string;
  altText: string | null;
  type: PhotoType;
}

// No customer display-name field exists on User (schema gap, out of scope to fix here) — reviews
// render without a name; clients should show something like "Verified customer" instead.
export interface ReviewSummaryDto {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string; // ISO 8601
}

// Listing/search-result card shape — extends the existing SalonSummary rather than duplicating
// its fields, adding only what a card needs beyond identity/location.
export interface SalonListItemDto extends SalonSummary {
  coverPhotoUrl: string | null;
  ratingAverage: number | null; // null when the salon has zero reviews yet
  ratingCount: number;
  priceMin: number | null; // computed from active services, null if none
  priceMax: number | null;
}

// Full profile page shape — everything a listing card has, plus the detail-page content.
export interface SalonProfileDto extends SalonListItemDto {
  description: string | null;
  phone: string | null;
  services: ServiceDto[];
  operatingHours: OperatingHoursDto[];
  photos: PhotoDto[];
  reviews: ReviewSummaryDto[]; // most recent, capped server-side (see API.md)
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface BookingDto {
  id: string;
  salonId: string;
  customerId: string;
  serviceId: string;
  slotStart: string; // ISO 8601
  slotEnd: string;
  status: BookingStatus;
  source: BookingSource;
  prepaymentRequiredAmount: number | null;
  cancellationChargeAmount: number | null;
}

export interface QueueEntryDto {
  id: string;
  salonId: string;
  bookingId: string | null;
  source: QueueEntrySource;
  tokenNumber: number;
  status: QueueEntryStatus;
  assignedStaffId: string | null;
  assignedChairId: string | null;
  estimatedWaitMinutes: number | null;
}

export interface SalonPaymentPolicyDto {
  salonId: string;
  prepaymentRequirement: PrepaymentRequirement;
  prepaymentPercentage: number | null;
}

export interface CancellationPolicyDto {
  salonId: string | null;
  freeCancellationWindowMinutes: number;
  lateCancellationChargeType: ChargeType;
  lateCancellationChargeValue: number;
  noShowChargeType: ChargeType;
  noShowChargeValue: number;
  appointmentArrivalGraceMinutes: number;
  queueCallResponseGraceMinutes: number;
}

export interface CustomerLedgerEntryDto {
  id: string;
  customerId: string;
  salonId: string;
  bookingId: string | null;
  amount: number;
  reason: string;
  status: string;
}

export interface HealthCheckResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
