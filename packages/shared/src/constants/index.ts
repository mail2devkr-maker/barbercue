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
  // Google Sign-In restricted to accounts that already hold SALON_OWNER and/or SALON_STAFF —
  // deliberately a separate endpoint from `google` above, not a shared one branching on a role
  // param: the two have opposite account-creation semantics (customer Google sign-in creates a
  // user on no match; this one must never create one), and keeping them physically separate
  // makes that difference impossible to blur by accident in either handler.
  staffGoogle: 'staff/google',
  adminLogin: 'admin/login',
  refresh: 'refresh',
  logout: 'logout',
  logoutAll: 'logout-all',
  sessions: 'sessions',
  forgotPassword: 'forgot-password',
  resetPassword: 'reset-password',
  me: 'me',
  // auth/methods — which sign-in methods this deployment can actually complete right now.
  // Booleans only; never echoes any configuration value.
  methods: 'methods',
} as const;

export const ADMIN_PATHS = {
  admin: 'admin',
  overview: 'overview',
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
  // cities/all — every city the platform operates in, unfiltered. Distinct from `cities`, which
  // deliberately lists only cities containing an ACTIVE salon (no dead-end SEO pages). Shop
  // registration needs the unfiltered list: filtering it would mean the first shop in a new city
  // could never be registered, because the city only becomes visible once such a shop is ACTIVE.
  allCities: 'all',
  // cities/search — Phase 6A's scalable Country -> Region -> City-search flow. Single literal
  // segment, same arity argument as `all` above: it can never be confused with the two-segment
  // :countryCode/:citySlug (B9) routes regardless of declaration order.
  citySearch: 'search',
  salons: 'salons',
  // Owner-scoped reads under salons/mine[/...] — literal 'mine' segment, registered before the
  // :citySlug/:salonSlug wildcard route in SalonsController so it can never be shadowed by it.
  mine: 'mine',
  // salons/workplaces — every salon the caller may operate, for owners AND staff. Distinct from
  // `mine`, which is owner-only and keyed on Salon.ownerUserId: a barber owns nothing, so that
  // route returns an empty list and leaves them with no way to reach the salon they work at.
  workplaces: 'workplaces',
} as const;

// New top-level `countries` controller (Phase 6A) — separate resource from DISCOVERY_PATHS'
// `cities`, additive to the existing discovery API surface.
export const COUNTRY_PATHS = {
  countries: 'countries',
  // countries/:countryId/regions
  regions: 'regions',
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
// Salon photo upload limits. Shared so the browser can reject a bad file before spending an
// upload on it and the server can reject the same file again on arrival — the client copy is a
// courtesy, the server copy is the boundary that actually counts.
export const SALON_PHOTO_UPLOAD = {
  // 5 MB, matching the Style Advisor's existing MAX_UPLOAD_BYTES — one upload ceiling across the
  // product rather than a second, different number for owners to trip over.
  maxBytes: 5 * 1024 * 1024,
  // The three formats every current browser and phone camera can produce and every browser can
  // render. Deliberately no HEIC: Safari uploads it happily but Chrome/Firefox cannot display it,
  // so accepting it would store photos that some customers simply never see.
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'] as const,
  // For the file picker's `accept` attribute. Extensions are a UI hint only — the server decides
  // by sniffing the file's magic bytes, never by trusting this or the browser's declared type.
  accept: 'image/jpeg,image/png,image/webp',
} as const;

export const DASHBOARD_PATHS = {
  dashboard: 'dashboard',
  salons: 'salons',
  queue: 'queue',
  queueEntries: 'queue-entries',
  serviceSessions: 'service-sessions',
  staff: 'staff',
  call: 'call',
  assign: 'assign',
  reassign: 'reassign',
  noShow: 'no-show',
  cancel: 'cancel',
  complete: 'complete',
  status: 'status',
  // Owner-set weekly opening times. AvailabilityService treats a day with no OperatingHours row
  // as closed and returns zero bookable slots, so until an owner sets these their shop can take
  // walk-ins through the queue but can never be booked.
  operatingHours: 'operating-hours',
  // Phase 9: authenticated "get my shop's QR/public queue URL" — mounted under the existing
  // dashboard/salons/:salonId/... shape alongside PublicQueueController's other routes.
  queueQr: 'queue-qr',
  // dashboard/salons/:salonId/photos/upload — multipart device upload. Additive sibling of the
  // JSON `photos` POST, which still takes an already-hosted https link and is unchanged; both
  // funnel into the same Photo row, so there is exactly one photo model, not two.
  photoUpload: 'upload',
  // Phase 11 (owner setup): salon-scoped roster/catalog management. `staff` above is reused —
  // note DashboardQueueController's existing `dashboard/staff/:id/status` (clock in/out) is a
  // DIFFERENT route from Phase 11's `dashboard/salons/:salonId/staff/:staffId`; the `salons/`
  // prefix keeps them from colliding.
  services: 'services',
  chairs: 'chairs',
  // Salon photos. URL-based for now — no object storage is configured, so an owner links an
  // image they already host rather than uploading a file.
  photos: 'photos',
  resendInvite: 'resend-invite',
  // Owner-only salon-scoped booking operations (Phase: owner booking dashboard) — mounted at
  // dashboard/salons/:salonId/bookings, same shape as `queue` above.
  bookings: 'bookings',
} as const;

// PublicQueueController's `@Controller('public-queue')` prefix (Phase 9 — shop QR queue entry).
// `:token` is Salon.publicQueueToken, never the internal Salon.id.
export const PUBLIC_QUEUE_PATHS = {
  publicQueue: 'public-queue',
  join: 'join',
} as const;
