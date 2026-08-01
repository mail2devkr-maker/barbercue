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

// Base segments for the public discovery API (CitiesController/SalonsController) — dynamic
// segments (:citySlug, :salonSlug, etc.) are interpolated at the call site, same pattern as
// HEALTH_PATH usage.
export const DISCOVERY_PATHS = {
  cities: 'cities',
  salons: 'salons',
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
} as const;
