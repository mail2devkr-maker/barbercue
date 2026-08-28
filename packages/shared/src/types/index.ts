import type {
  BookingSource,
  BookingStatus,
  ChairStatus,
  ChargeType,
  PhotoType,
  PrepaymentRequirement,
  QueueEntrySource,
  QueueEntryStatus,
  Role,
  SalonStaffRole,
  SalonStatus,
  StaffMemberStatus,
  SubscriptionStatus,
  CustomerSubscriptionStatus,
  UserStatus,
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

/**
 * GET auth/methods — which sign-in methods this deployment can complete, so a client never
 * presents a form that is guaranteed to fail. Phone OTP depends on an SMS provider that may not
 * be configured; when it isn't, OtpSender throws OTP_DELIVERY_FAILED and the customer sees a 502
 * after typing their number. Exposing the capability lets the UI say so up front instead.
 *
 * Deliberately booleans only — this endpoint is public and must never reveal which key is set,
 * let alone its value.
 */
export interface AuthMethodsDto {
  google: boolean;
  phoneOtp: boolean;
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
  // Permanent, human-shareable identifier ("BC-SHOP-000001") — distinct from `id` (the internal
  // UUID, an implementation detail never meant for display). See Salon.publicId in schema.prisma.
  publicId: string;
  name: string;
  slug: string;
  citySlug: string;
  localitySlug?: string;
  addressLine: string;
  // ISO-3166-1 alpha-2 of the salon's city — drives postal labels, phone hints and number
  // grouping on the client without a second lookup.
  countryCode: string;
  // ISO-4217. Null where the country has no authoritative mapping wired yet; clients must render
  // a bare amount rather than assuming a symbol (see formatMoney).
  currency: string | null;
  // Postal/ZIP code as entered. Format is country-specific — see postalCodeRuleFor.
  postalCode: string | null;
  // Null when the owner registered without granting GPS permission (or from a desktop). Consumed
  // only by the schema.org `geo` block on the public salon page, which omits itself when absent.
  lat: number | null;
  lng: number | null;
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
  // ISO-3166-1 alpha-2. The field client logic should key on — `country` below is free-text
  // display data and must not be used for validation, currency or routing decisions.
  countryCode: string;
  // ISO-3166-2 subdivision where known; null where a country has none worth recording.
  regionCode: string | null;
  state: string;
  country: string;
}

export interface LocalityDto {
  id: string;
  name: string;
  slug: string;
  citySlug: string;
}

// ---------- Global location discovery (Phase 6A) ----------
// Additive, separate from CityDto/LocalityDto above (untouched) — these back the new
// Country -> Region -> City-search selection flow, not the existing B9 city/locality routes.

export interface CountryDto {
  id: string;
  name: string;
  isoCode2: string;
  // Deliberately NOT used to decide whether to show a Region step (see ARCHITECTURE notes on
  // Country.hasSubdivisions) — it stays at the schema default until a real product decision is
  // made. Callers must derive that from whether GET /countries/:id/regions returns any rows.
  hasSubdivisions: boolean;
}

export interface RegionDto {
  id: string;
  name: string;
  // ISO-3166-2 where the source dataset provided one; null otherwise. Never fabricated.
  code: string | null;
}

// Lean by design: population/coordinates/source-provenance fields exist on the underlying City
// row but are never sent to the browser here — this DTO exists specifically to keep the search
// endpoint's payload small at ~100K-city scale.
export interface CitySearchResultDto {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  region: { id: string; name: string; code: string | null } | null;
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

// POST /salons response — deliberately minimal (not a full SalonProfileDto): a brand-new shop has
// no services/photos/reviews/operating-hours yet, so returning those empty arrays would just be
// noise. `status` is always "PENDING" at creation (Salon.status's existing default), surfaced so
// the owner dashboard can show a moderation-pending state without a second round-trip.
export interface RegisterSalonResultDto {
  id: string;
  publicId: string;
  slug: string;
  name: string;
  status: SalonStatus;
}

/**
 * A salon the caller may operate, from GET salons/workplaces. Resolved from UserRole membership —
 * the same rule SalonAccessService.assertAccess enforces — so "what I can see listed" and "what I
 * can actually open" can never drift apart.
 *
 * `isOwner` is presentation only: it tells the dashboard whether to offer setup links or just the
 * live queue. It grants nothing on its own — every owner-only endpoint still checks
 * @Roles(SALON_OWNER) plus assertAccess server-side.
 */
export interface SalonWorkplaceDto {
  id: string;
  publicId: string;
  slug: string;
  name: string;
  status: SalonStatus;
  isOwner: boolean;
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
  // Phase 3B: soft preference only, null = "Any Staff" — see DATABASE.md's Booking section. Never
  // affects availability/capacity.
  preferredStaffId: string | null;
  prepaymentRequiredAmount: number | null;
  cancellationChargeAmount: number | null;
  // AI Style Advisor hand-off (major-upgrade phase) — the style name the customer picked via
  // "Try This Look" before booking, null for every ordinary booking. Free text at this layer
  // (not a foreign key) since HAIRSTYLE_CATALOG is a shared constant, not a DB table.
  selectedStyleName: string | null;
}

// ---------- AI Style Advisor (Phase E) ----------

// POST style-advisor/generate response item. `matchPercent` backs the UI's "AI Style Match NN%"
// wording — deliberately never "best match" or a guarantee (see the landing page's own copy).
export interface HairstylePreviewDto {
  styleId: string;
  styleName: string;
  previewUrl: string;
  matchPercent: number;
}

export interface StyleAdvisorResultDto {
  results: HairstylePreviewDto[];
}

// ---------- Booking flow (Phase 3B) ----------

// GET /salons/:salonId/staff?serviceId= — "Any Staff" is a client-side option, never returned here.
export interface StaffOptionDto {
  id: string;
  displayName: string;
}

export interface AvailabilitySlotDto {
  slotStart: string; // ISO 8601
  slotEnd: string;
  available: boolean;
}

// Adds display fields a UI needs (booking confirmation, list, detail) without extra round-trips —
// same pattern as SalonListItemDto extending SalonSummary in Phase 3A.
export interface BookingDetailDto extends BookingDto {
  // ISO-4217 of the salon this booking belongs to; null when unknown.
  currency: string | null;
  salonName: string;
  salonSlug: string;
  citySlug: string;
  serviceName: string;
  serviceDurationMinutes: number;
  servicePrice: number;
  preferredStaffName: string | null;
}

export interface CancelBookingResponseDto {
  booking: BookingDetailDto;
  chargeAmount: number;
  ledgerEntryCreated: boolean;
}

// ---------- Owner booking dashboard ----------

// `today`/`upcoming` are date-window views over active bookings; `completed`/`cancelled`/
// `no_show` are outcome views regardless of date; `all` is the unfiltered history feed. Kept as a
// flat union (not derived from BookingStatus) since `today`/`upcoming`/`all` aren't statuses.
export const OWNER_BOOKING_FILTERS = [
  'today',
  'upcoming',
  'completed',
  'cancelled',
  'no_show',
  'all',
] as const;
export type OwnerBookingFilter = (typeof OWNER_BOOKING_FILTERS)[number];

// Adds owner-operational fields (customer contact, assigned barber, timestamps) on top of
// BookingDetailDto — never exposed to the customer-facing booking endpoints, only the owner
// dashboard. Same "extend the base DTO" pattern as BookingDetailDto extending BookingDto.
export interface OwnerBookingDetailDto extends BookingDetailDto {
  customerPhone: string | null;
  customerEmail: string | null;
  // The barber actually assigned at queue check-in (QueueEntry.assignedStaffId), distinct from
  // preferredStaffId/preferredStaffName above (the customer's soft preference at booking time).
  // Null until the booking reaches check-in.
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  cancelledAt: string | null; // ISO 8601
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

// ---------- Queue & check-in (Phase 3C) ----------

// Adds display fields a UI needs (customer queue-status view, staff dashboard) without extra
// round-trips — same "extend the base DTO" pattern as BookingDetailDto extending BookingDto.
export interface QueueEntryDetailDto extends QueueEntryDto {
  serviceId: string | null;
  serviceName: string | null;
  position: number | null; // 1-based rank among WAITING entries at this salon, null once past WAITING
  customerPhone: string | null;
  assignedStaffName: string | null;
  assignedChairLabel: string | null;
  activeServiceSessionId: string | null; // target id for POST .../service-sessions/:id/complete
  joinedAt: string; // ISO 8601
  calledAt: string | null;
}

// GET /dashboard/salons/:salonId/booking/staff mirror for the live queue's chair dropdown.
export interface ChairOptionDto {
  id: string;
  label: string;
}

// GET /dashboard/salons/:salonId/queue — embeds the roster/chairs read-only so the assign UI works
// without needing the (out-of-scope in Phase 3C) staff/chair CRUD endpoints. staffRoster includes
// BOTH ACTIVE and INACTIVE staff (with their current status) so the dashboard's clock-in/out
// toggle can also bring an off-duty staff member back on — an ACTIVE-only list would make an
// inactive staff member invisible here and unable to clock themselves back in. The assign action
// itself still separately re-validates ACTIVE + qualified via AvailabilityService.
export interface DashboardQueueDto {
  entries: QueueEntryDetailDto[];
  staffRoster: StaffStatusDto[];
  chairs: ChairOptionDto[];
}

// GET /salons/:salonId/queue/status — public, lightweight, no PII.
export interface QueueStatusDto {
  salonId: string;
  waitingCount: number;
  estimatedWaitMinutes: number | null;
}

// PATCH /dashboard/staff/:id/status response.
export interface StaffStatusDto {
  id: string;
  displayName: string;
  status: StaffMemberStatus;
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

// ---------- Premium plans & AI credits (Premium phase) ----------

// GET premium/plans response item. price is a plain number (rupees, not paise) — matches every
// other money field in this file (ServiceDto.price etc.), all sourced from Prisma Decimal columns
// converted at the service layer.
export interface CustomerPremiumPlanDto {
  id: string;
  name: string;
  priceInr: number;
  aiCreditsPerYear: number;
  isPopular: boolean;
}

// GET premium/me response — the caller's current Premium status. All fields null/false when the
// customer has no active subscription (never omitted, so clients don't need an extra existence
// check).
export interface PremiumEntitlementDto {
  isPremium: boolean;
  planId: string | null;
  planName: string | null;
  periodEnd: string | null; // ISO 8601
}

// GET premium/credits response — available is always allocated - reserved - consumed, computed
// server-side; clients never derive or trust their own copy of this number.
export interface AiCreditBalanceDto {
  allocated: number;
  reserved: number;
  consumed: number;
  available: number;
}

// ---------- Shop QR / public queue entry (Phase 9) ----------

// GET public-queue/:token — service option shown on the public join page. Deliberately minimal:
// id is required for the join call itself (server re-validates it against the token's salon
// regardless), name/durationMinutes are display-only.
export interface PublicQueueServiceOptionDto {
  id: string;
  name: string;
  durationMinutes: number;
}

// GET public-queue/:token response. Never includes Salon.id, ownerUserId, or anything not needed
// to render the public join page. queueAvailable distinguishes "token resolves but this shop
// isn't currently accepting queue joins" (status !== ACTIVE) from an unknown/invalid token, which
// the controller instead returns as a 404 — the frontend shows a different message for each.
export interface PublicQueueInfoDto {
  salonName: string;
  queueAvailable: boolean;
  services: PublicQueueServiceOptionDto[];
  waitingCount: number;
  estimatedWaitMinutes: number | null;
}

// GET dashboard/salons/:salonId/queue-qr response — authenticated, owner/staff-only. The frontend
// renders the QR client-side from publicQueueUrl; nothing here is itself an image.
export interface PublicQueueQrDto {
  publicQueueToken: string;
  publicQueueUrl: string;
}

// ---------- Salon owner setup: services / chairs / staff (Phase 11) ----------

// Owner-facing view of a Service. Distinct from the public ServiceDto above, which is only ever
// returned for ACTIVE salons and never exposes inactive rows — an owner must see and manage both.
export interface SalonServiceDto {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  category: string | null;
  isActive: boolean;
  // ISO-4217 of the owning salon; null when unknown. Prices are major units.
  currency: string | null;
}

// Owner-facing chair. ChairOptionDto (above) stays the queue dashboard's lighter read model;
// this adds the status an owner needs to manage.
export interface SalonChairDto {
  id: string;
  label: string;
  status: ChairStatus;
}

// Owner-facing roster entry. Phone/email come from the linked User account (SalonStaff itself has
// no duplicate contact columns). Legacy staff may have email but no phone; new rows require phone.
export interface SalonStaffDto {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  roleInSalon: SalonStaffRole;
  status: StaffMemberStatus;
  hasPassword: boolean;
}

// POST .../staff response. invitationSent stays truthful for email-less staff. `inviteUrl` is
// populated ONLY outside production — in production a real link is delivered by EmailSender and
// never returned over the API.
export interface StaffInviteResultDto {
  staff: SalonStaffDto;
  invitationSent: boolean;
  inviteUrl?: string;
}

// PATCH dashboard/salons/:salonId/status response — the owner-visible activation state.
export interface SalonStatusResultDto {
  id: string;
  status: SalonStatus;
}

/**
 * What a PENDING salon still needs before it can be opened. Carried as the `details` payload of a
 * SALON_SETUP_INCOMPLETE error so the client can render a per-item checklist ("✓ Service added /
 * ✗ Add at least one barber") instead of one undifferentiated sentence.
 *
 * Each flag counts only rows that are actually usable — an ACTIVE chair, an ACTIVE staff member,
 * an `isActive` service — because a deactivated one contributes nothing to serving a customer.
 */
export interface SalonSetupReadinessDto {
  hasActiveService: boolean;
  hasActiveChair: boolean;
  hasActiveStaff: boolean;
}

// ---------- Platform admin monitoring ----------

export interface PlatformAdminOverviewDto {
  generatedAt: string;
  counts: {
    shops: number;
    owners: number;
    staff: number;
    customers: number;
    bookings: number;
    liveQueueEntries: number;
    activePremiumSubscriptions: number;
  };
  shops: Array<{
    id: string;
    publicId: string;
    name: string;
    status: SalonStatus;
    subscriptionStatus: SubscriptionStatus;
    ownerEmail: string | null;
    ownerPhone: string | null;
    staffCount: number;
    bookingCount: number;
    liveQueueCount: number;
    createdAt: string;
  }>;
  staff: Array<{
    id: string;
    displayName: string;
    status: StaffMemberStatus;
    salonName: string;
    salonPublicId: string;
    email: string | null;
    phone: string | null;
  }>;
  customers: Array<{
    id: string;
    status: UserStatus;
    email: string | null;
    phone: string | null;
    bookingCount: number;
    queueEntryCount: number;
    isPremium: boolean;
    createdAt: string;
  }>;
  recentBookings: Array<{
    id: string;
    status: BookingStatus;
    slotStart: string;
    salonName: string;
    serviceName: string;
    customerEmail: string | null;
    customerPhone: string | null;
  }>;
  recentQueue: Array<{
    id: string;
    tokenNumber: number;
    status: QueueEntryStatus;
    joinedAt: string;
    salonName: string;
    serviceName: string | null;
    customerPhone: string | null;
    assignedStaffName: string | null;
    assignedChairLabel: string | null;
  }>;
  premiumSubscriptions: Array<{
    id: string;
    status: CustomerSubscriptionStatus;
    planName: string;
    periodEnd: string;
    customerEmail: string | null;
    customerPhone: string | null;
  }>;
}

export interface HealthCheckResponse {
  status: 'ok';
  service: string;
  timestamp: string;
}
