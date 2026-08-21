// Cross-cutting constants shared by the backend (route/controller definitions) and clients
// (URL construction) — kept here so the literal never has to be duplicated or drift between them.

// Matches the backend's HealthController's @Controller() path. Clients build the full URL as
// `${API_BASE_URL}/${HEALTH_PATH}`, where API_BASE_URL already includes the /api/v1 prefix.
export const HEALTH_PATH = 'health';

// Sub-paths under AuthController's `@Controller('auth')` prefix — used directly as `@Post(...)`
// decorator arguments on the backend, and as `${API_BASE_URL}/auth/${AUTH_PATHS.otpRequest}` on
// clients. Kept here so the literal path strings never drift between the two.
export const AUTH_PATHS = {
  otpRequest: 'otp/request',
  otpVerify: 'otp/verify',
  google: 'google',
  staffLogin: 'staff/login',
  adminLogin: 'admin/login',
  refresh: 'refresh',
  logout: 'logout',
  logoutAll: 'logout-all',
  sessions: 'sessions',
  forgotPassword: 'forgot-password',
  resetPassword: 'reset-password',
  me: 'me',
} as const;

// Name of the httpOnly cookie the backend sets/reads for web refresh-token delivery. Shared so
// the web app's fetch wrapper knows to send credentials, without needing to know the token value.
export const REFRESH_TOKEN_COOKIE_NAME = 'barbercue_refresh_token';

// Client-side "Resend OTP" cooldown, in seconds — a UI throttle only, purely to stop a user from
// mashing the button; it is deliberately shorter than OtpService's server-side per-phone rate
// limit (3 requests / 10 minutes, see otp.service.ts), which remains the real security boundary
// and is never touched by this constant. Shared so apps/web and apps/mobile can't drift apart.
export const OTP_RESEND_COOLDOWN_SECONDS = 45;

// Base segments for the public discovery API (CitiesController/SalonsController) — dynamic
// segments (:citySlug, :salonSlug, etc.) are interpolated at the call site, same pattern as
// HEALTH_PATH usage.
export const DISCOVERY_PATHS = {
  cities: 'cities',
  salons: 'salons',
  // Owner-scoped reads under salons/mine[/...] — literal 'mine' segment, registered before the
  // :citySlug/:salonSlug wildcard route in SalonsController so it can never be shadowed by it.
  mine: 'mine',
} as const;

// Sub-paths for booking-related reads that hang off a salon (DISCOVERY_PATHS.salons/:salonId/...)
// — kept separate from DISCOVERY_PATHS since these are authenticated/booking-flow endpoints, not
// public SEO discovery, even though they share the same `salons` URL segment.
export const SALON_BOOKING_INFO_PATHS = {
  staff: 'staff',
  availability: 'availability',
  cancellationPolicy: 'cancellation-policy',
} as const;

// BookingsController's `@Controller('bookings')` prefix.
export const BOOKING_PATHS = {
  bookings: 'bookings',
  mine: 'mine',
  cancel: 'cancel',
  checkIn: 'check-in',
} as const;

// Sub-paths under `salons/:salonId/queue` (SalonQueueController) — a 3-segment shape deliberately,
// not a bare `salons/:salonId/queue-status`, to avoid the same discovery-route collision class
// fixed in Phase 3B (see SalonsController's `:citySlug/:salonSlug`).
export const SALON_QUEUE_PATHS = {
  status: 'status',
  join: 'join',
} as const;

// QueueEntriesController's `@Controller('queue-entries')` prefix (customer view).
export const QUEUE_ENTRIES_PATH = 'queue-entries';

// StyleAdvisorController's `@Controller('style-advisor')` prefix.
export const STYLE_ADVISOR_PATHS = {
  styleAdvisor: 'style-advisor',
  generate: 'generate',
} as const;

// A small, fixed style catalog (major-upgrade phase) — not salon-configurable data, so a shared
// constant rather than a DB table (see AI Style Advisor's Phase E notes). Used by the landing
// page's "Popular styles" section and the AI Style Advisor's generation request/results, so both
// always agree on the same names. General barbershop styles only — nothing brand-specific.
export const HAIRSTYLE_CATALOG = [
  { id: 'crew-cut', name: 'Crew Cut' },
  { id: 'fade', name: 'Fade' },
  { id: 'pompadour', name: 'Pompadour' },
  { id: 'buzz-cut', name: 'Buzz Cut' },
  { id: 'textured-quiff', name: 'Textured Quiff' },
  { id: 'undercut', name: 'Undercut' },
  { id: 'slick-back', name: 'Slick Back' },
  { id: 'crop', name: 'Crop' },
] as const;

// PremiumController's `@Controller('premium')` prefix (Premium plans + AI credits phase).
export const PREMIUM_PATHS = {
  premium: 'premium',
  plans: 'plans',
  me: 'me',
  credits: 'credits',
  // Dev/test-only activation — PremiumController rejects this outside a non-production
  // environment; never reachable in production regardless of who calls it.
  devActivate: 'dev/activate',
} as const;

// Single authoritative list of Premium plan ids — used to validate PremiumDevActivateInput and
// anywhere else client/server code needs to enumerate the fixed 3-plan catalog without a round
// trip. Actual price/credit values live in CustomerPremiumPlan (DB) via PremiumPlansService,
// never duplicated here.
export const PREMIUM_PLAN_IDS = ['basic', 'pro', 'max'] as const;

// DashboardQueueController's `@Controller('dashboard')` prefix — staff/owner queue operations.
export const DASHBOARD_PATHS = {
  dashboard: 'dashboard',
  salons: 'salons',
  queue: 'queue',
  queueEntries: 'queue-entries',
  serviceSessions: 'service-sessions',
  staff: 'staff',
  call: 'call',
  assign: 'assign',
  noShow: 'no-show',
  cancel: 'cancel',
  complete: 'complete',
  status: 'status',
  // Phase 9: authenticated "get my shop's QR/public queue URL" — mounted under the existing
  // dashboard/salons/:salonId/... shape alongside PublicQueueController's other routes.
  queueQr: 'queue-qr',
} as const;

// PublicQueueController's `@Controller('public-queue')` prefix (Phase 9 — shop QR queue entry).
// `:token` is Salon.publicQueueToken, never the internal Salon.id.
export const PUBLIC_QUEUE_PATHS = {
  publicQueue: 'public-queue',
  join: 'join',
} as const;
