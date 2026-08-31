import { z } from 'zod';
import {
  ChairStatus,
  ChargeType,
  Language,
  NotificationCategory,
  NotificationChannel,
  PhotoType,
  PrepaymentRequirement,
  SalonStatus,
  StaffMemberStatus,
  VerificationStatus,
} from '../enums';
import { PREMIUM_PLAN_IDS } from '../constants';
import { isValidPostalCode, postalCodeRuleFor } from '../locale';

// Validation schemas shared by the backend (request validation) and clients (form validation).
// The backend is always the authority — these schemas exist so both sides reject bad input the
// same way before a request ever reaches the server, not to move validation off the server.

export const createBookingSchema = z.object({
  salonId: z.string().uuid(),
  serviceId: z.string().uuid(),
  slotStart: z.string().datetime(),
  // Soft preference only ("Any Staff" = omitted) — see DATABASE.md's Booking section.
  preferredStaffId: z.string().uuid().optional(),
  // AI Style Advisor hand-off (major-upgrade phase) — set when booking arrives via "Try This
  // Look" -> "Book This Style"; omitted for every ordinary booking.
  selectedStyleName: z.string().min(1).max(100).optional(),
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// POST bookings/:id/reschedule — only the slot moves; service/staff/salon are unchanged (a
// different service or salon is a new booking, not a reschedule of this one).
export const rescheduleBookingSchema = z.object({
  slotStart: z.string().datetime(),
});
export type RescheduleBookingInput = z.infer<typeof rescheduleBookingSchema>;

// GET /salons/:salonId/availability query params.
export const availabilityQuerySchema = z.object({
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  staffId: z.string().uuid().optional(),
});
export type AvailabilityQueryInput = z.infer<typeof availabilityQuerySchema>;

// GET /salons/:salonId/staff query params.
export const staffListQuerySchema = z.object({
  serviceId: z.string().uuid(),
});
export type StaffListQueryInput = z.infer<typeof staffListQuerySchema>;

export const joinQueueSchema = z.object({
  serviceId: z.string().uuid().optional(),
  // Launch-fixes (Issue 6) — the customer's requested barber for this walk-in visit; omitted
  // means "Any available professional", exactly like Booking.preferredStaffId's own convention.
  preferredStaffId: z.string().uuid().optional(),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

// POST /dashboard/queue-entries/:id/assign — serviceId is only required when the queue entry
// itself has none (e.g. a walk-in that never picked one); validated in the service layer, not
// here, since that depends on the target entry's existing state.
export const assignQueueEntrySchema = z.object({
  staffId: z.string().uuid(),
  chairId: z.string().uuid(),
  serviceId: z.string().uuid().optional(),
});
export type AssignQueueEntryInput = z.infer<typeof assignQueueEntrySchema>;

// PATCH /dashboard/queue-entries/:id/reassign — only the assignment changes. Service, token,
// queue position and timestamps remain authoritative on the existing entry/session.
export const reassignQueueEntrySchema = z
  .object({
    staffId: z.string().uuid().optional(),
    chairId: z.string().uuid().optional(),
  })
  .refine((v) => v.staffId !== undefined || v.chairId !== undefined, {
    message: 'Choose a barber, a chair, or both',
  });
export type ReassignQueueEntryInput = z.infer<typeof reassignQueueEntrySchema>;

// PATCH /dashboard/staff/:id/status
export const staffStatusSchema = z.object({
  status: z.nativeEnum(StaffMemberStatus),
});
export type StaffStatusInput = z.infer<typeof staffStatusSchema>;

// POST /salons — shop registration (major-upgrade phase). Reuses an existing City (by slug)
// rather than accepting free-text state/country here, which would let a typo silently create a
// duplicate/junk City row — city curation stays a separate, existing concern (CitiesService).
// Indian PIN codes are exactly six digits and never start with 0 (the leading digit is the
// postal region, 1-8). Anchored so "560001abc" and "56 00 01" are rejected rather than coerced.
export const INDIAN_PIN_CODE_REGEX = /^[1-9][0-9]{5}$/;

export const registerSalonSchema = z
  .object({
    name: z.string().min(1).max(200),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    addressLine: z.string().min(1).max(300),
    // ISO-3166-1 alpha-2 of the selected city's country. Sent by the client so postal validation
    // below can pick the right rule before any database lookup; SalonsService independently
    // verifies it matches the resolved City, so a mismatched value cannot be used to bypass a
    // country's postal rule.
    countryCode: z.string().length(2),
    // Country-aware. India keeps exactly the rule it had (6 digits, no leading zero); every other
    // country falls back to a permissive pattern rather than a guessed one, and countries with no
    // postal system may leave it blank. See postalCodeRuleFor in ../locale.
    postalCode: z.string().max(12).optional(),
    // Optional since Phase 11: coordinates are captured from the device's GPS by the registration
    // form's "Use my current location" button, never typed. An owner who denies that permission —
    // or registers from a desktop with no GPS — still gets a working shop; the address + city +
    // PIN code identify it. lat/lng's only consumer is the schema.org `geo` block on the public
    // salon page, which omits itself when they are absent.
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    citySlug: z.string().min(1),
    localitySlug: z.string().optional(),
  })
  // A half-coordinate is meaningless — it would place the shop on the equator or the prime
  // meridian. Either both arrive or neither does.
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Latitude and longitude must be provided together',
    path: ['lat'],
  })
  .superRefine((v, ctx) => {
    if (isValidPostalCode(v.countryCode, v.postalCode)) return;
    const rule = postalCodeRuleFor(v.countryCode);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postalCode'],
      message: rule.example
        ? `Enter a valid ${rule.label} (for example ${rule.example})`
        : `Enter a valid ${rule.label}`,
    });
  });
export type RegisterSalonInput = z.infer<typeof registerSalonSchema>;

// GET /salons query params — validated the same way on backend (ZodValidationPipe on @Query())
// and client (search form) so both agree on shape before a request is ever made.
export const salonSearchQuerySchema = z.object({
  city: z.string().optional(),
  // ISO-3166-1 alpha-2, scopes `city` to an exact (countryCode, slug) match — see B9. Optional:
  // not every caller has a country in hand (free-text/service search), so omitting it falls back
  // to matching `city` by slug alone, exactly as before this field existed.
  countryCode: z.string().length(2).optional(),
  locality: z.string().optional(),
  service: z.string().optional(),
  q: z.string().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  // "Near Me" (Phase 4) — the device's current position, from the browser/RN geolocation API, not
  // a paid geocoding service. Both-or-neither: a lone lat/lng is meaningless, so the service
  // ignores either one supplied without its pair rather than guessing 0 for the other.
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type SalonSearchQueryInput = z.infer<typeof salonSearchQuerySchema>;

// GET /cities/search query params (Phase 6A — Country -> Region -> City-search selection flow).
// countryId is required: a global, unscoped city search across ~100K rows is never allowed.
// `q` is intentionally left unbounded in length here (trimmed/short-circuited in the service, not
// rejected here) so an empty/short query is a normal "still typing" UI state, not a validation
// error.
// countryId is optional (Issue 10): the registration flow always supplies it (a scoped, in-app
// picker with no reason to search worldwide), but the public search page's city field has no
// country pre-selected, and forcing one before the customer can even start typing would be worse
// UX than a capped, index-backed global search. When omitted, searchCities matches across every
// country and returns each result's own country/region for on-screen disambiguation.
export const citySearchQuerySchema = z.object({
  countryId: z.string().uuid().optional(),
  regionId: z.string().uuid().optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type CitySearchQueryInput = z.infer<typeof citySearchQuerySchema>;

// GET search/suggest query params (Issue 3) — typo-tolerant shop/service autosuggest for the
// search page's "Shop or service" field. Same MIN-length short-circuit convention as city search:
// enforced in the service, not rejected here, so one typed letter is a quiet "keep typing" state.
export const searchSuggestQuerySchema = z.object({
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
export type SearchSuggestQueryInput = z.infer<typeof searchSuggestQuerySchema>;

// POST cities (Issue 7) — the "Use '<name>' as entered" fallback for a shop whose city genuinely
// isn't in the imported master list yet. Only ever reachable from the registration flow after a
// real city search has already come back empty, never a substitute for searching first.
export const createOwnerCitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  countryId: z.string().uuid(),
  regionId: z.string().uuid().optional(),
});
export type CreateOwnerCityInput = z.infer<typeof createOwnerCitySchema>;

export const otpRequestSchema = z.object({
  phone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format, e.g. +919876543210'),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: z.string(),
  code: z.string().length(6),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

// POST /auth/google — the client only ever sends the ID token it got directly from Google's own
// sign-in SDK (Google Identity Services on web, expo-auth-session on mobile); the backend is what
// verifies it against Google, never the other way around.
export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

// Shared password rule: staff/owner/admin accounts only (customers never have a password).
const passwordSchema = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(72, 'password must be at most 72 characters'); // bcrypt truncates beyond 72 bytes

export const staffLoginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
  // Optional at the schema layer so the service can distinguish "missing TOTP" (→
  // TOTP_REQUIRED) from "wrong shape" (→ 400) rather than zod rejecting the request outright.
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'totpCode must be 6 digits')
    .optional(),
});
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;

export const adminGoogleLoginSchema = z.object({
  idToken: z.string().min(1),
  // Google proves possession of the existing admin's identity; it never replaces the second
  // factor. Keeping this optional lets the service return TOTP_REQUIRED before any session is
  // issued, then verify the same Google credential together with the authenticator code.
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'totpCode must be 6 digits')
    .optional(),
});
export type AdminGoogleLoginInput = z.infer<typeof adminGoogleLoginSchema>;

export const refreshRequestSchema = z.object({
  // Optional: web relies on the httpOnly refresh cookie instead of sending this in the body.
  refreshToken: z.string().optional(),
});
export type RefreshRequestInput = z.infer<typeof refreshRequestSchema>;

export const logoutRequestSchema = z.object({
  refreshToken: z.string().optional(),
});
export type LogoutRequestInput = z.infer<typeof logoutRequestSchema>;

export const passwordAudienceSchema = z.enum(['owner', 'staff', 'admin']);
export type PasswordAudience = z.infer<typeof passwordAudienceSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
  // Navigation hint only. The backend still decides eligibility from stored roles and always
  // returns the same public response, so this cannot be used to discover or elevate accounts.
  audience: passwordAudienceSchema.optional(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const initialPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: passwordSchema,
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
export type InitialPasswordInput = z.infer<typeof initialPasswordSchema>;

export const salonPaymentPolicySchema = z
  .object({
    prepaymentRequirement: z.nativeEnum(PrepaymentRequirement),
    prepaymentPercentage: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (val) => val.prepaymentRequirement !== PrepaymentRequirement.PARTIAL || !!val.prepaymentPercentage,
    { message: 'prepaymentPercentage is required when prepaymentRequirement is PARTIAL', path: ['prepaymentPercentage'] },
  );
export type SalonPaymentPolicyInput = z.infer<typeof salonPaymentPolicySchema>;

export const cancellationPolicySchema = z.object({
  freeCancellationWindowMinutes: z.number().int().min(0),
  lateCancellationChargeType: z.nativeEnum(ChargeType),
  lateCancellationChargeValue: z.number().min(0),
  noShowChargeType: z.nativeEnum(ChargeType),
  noShowChargeValue: z.number().min(0),
  appointmentArrivalGraceMinutes: z.number().int().min(0),
  queueCallResponseGraceMinutes: z.number().int().min(0),
});
export type CancellationPolicyInput = z.infer<typeof cancellationPolicySchema>;

// ---------- Salon owner setup (Phase 11) ----------

// POST dashboard/salons/:salonId/services. Price is rupees (matches Service.price's Decimal(10,2)
// and every other money field in this package); duration is whole minutes because the whole
// booking/slot engine works in minutes.
export const createSalonServiceSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  price: z.number().min(0).max(1_000_000),
  durationMinutes: z.number().int().min(5).max(480),
  category: z.string().min(1).max(60).optional(),
});
export type CreateSalonServiceInput = z.infer<typeof createSalonServiceSchema>;

// PATCH .../services/:serviceId — every field optional (partial update). `isActive: false` is the
// soft-delete: Service is foreign-keyed from Booking/QueueEntry/ServiceSession, so rows are
// never hard-deleted.
export const updateSalonServiceSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    price: z.number().min(0).max(1_000_000).optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    category: z.string().min(1).max(60).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateSalonServiceInput = z.infer<typeof updateSalonServiceSchema>;

// "HH:mm", 24-hour. Matches exactly what OperatingHours.openTime/closeTime already store and what
// AvailabilityService's istWallTimeToUtc parses — this is a validator for the existing format,
// not a new one.
export const TIME_OF_DAY_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const operatingHoursEntrySchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: z.string().regex(TIME_OF_DAY_REGEX, 'Use a time like 09:00'),
    closeTime: z.string().regex(TIME_OF_DAY_REGEX, 'Use a time like 21:00'),
    isClosed: z.boolean(),
  })
  // Only meaningful on an open day; a closed day's times are ignored by AvailabilityService.
  // Overnight hours (close before open) are deliberately rejected rather than silently accepted:
  // the availability engine resolves open/close within a single IST calendar day, so a
  // 20:00–02:00 shift would produce an empty or negative window, not a late-night salon.
  .refine((v) => v.isClosed || v.closeTime > v.openTime, {
    message: 'Closing time must be after opening time',
    path: ['closeTime'],
  });

// PUT dashboard/salons/:salonId/operating-hours — the whole week, replaced in one call. A weekly
// schedule is edited as a unit, so this avoids the partially-saved week that per-day PATCHes
// would allow (e.g. Monday saved, Tuesday failed) and keeps the client to one round-trip.
export const setOperatingHoursSchema = z
  .object({
    days: z.array(operatingHoursEntrySchema).length(7),
  })
  .refine((v) => new Set(v.days.map((d) => d.dayOfWeek)).size === 7, {
    message: 'Provide exactly one entry for each day of the week',
    path: ['days'],
  });
export type SetOperatingHoursInput = z.infer<typeof setOperatingHoursSchema>;

// PUT dashboard/salons/:salonId/staff/:staffId/working-hours (Phase 7) — same one-call,
// whole-week-replaced shape and rationale as setOperatingHoursSchema, reusing the exact same
// per-day entry schema (identical validation rules — a "HH:mm" pair and an overnight-hours guard
// apply equally to a barber's personal hours).
export const setStaffWorkingHoursSchema = z
  .object({
    days: z.array(operatingHoursEntrySchema).length(7),
  })
  .refine((v) => new Set(v.days.map((d) => d.dayOfWeek)).size === 7, {
    message: 'Provide exactly one entry for each day of the week',
    path: ['days'],
  });
export type SetStaffWorkingHoursInput = z.infer<
  typeof setStaffWorkingHoursSchema
>;

// PUT notifications/preferences (Phase 13) — one (category, channel) toggle per call; the client
// already has the full NotificationPreferencesDto to render from, so there's no need for a
// whole-preferences-replaced-at-once shape the way OperatingHours/StaffWorkingHours use.
export const setNotificationPreferenceSchema = z.object({
  category: z.enum([
    NotificationCategory.BOOKING_UPDATES,
    NotificationCategory.QUEUE_UPDATES,
    NotificationCategory.REMINDERS,
    NotificationCategory.PROMOTIONAL,
  ]),
  channel: z.enum([
    NotificationChannel.IN_APP,
    NotificationChannel.PUSH,
    NotificationChannel.EMAIL,
    NotificationChannel.SMS,
    NotificationChannel.WHATSAPP,
  ]),
  enabled: z.boolean(),
});
export type SetNotificationPreferenceInput = z.infer<
  typeof setNotificationPreferenceSchema
>;

const expoPushTokenSchema = z
  .string()
  .trim()
  .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/, 'Invalid Expo push token');

export const registerPushDeviceSchema = z
  .object({
    platform: z.enum(['ANDROID', 'IOS']),
    provider: z.literal('EXPO'),
    pushToken: expoPushTokenSchema,
    installationId: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
  })
  .strict();
export type RegisterPushDeviceInput = z.infer<typeof registerPushDeviceSchema>;

export const unregisterPushDeviceSchema = z
  .object({
    installationId: z
      .string()
      .trim()
      .min(8)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    provider: z.literal('EXPO'),
  })
  .strict();
export type UnregisterPushDeviceInput = z.infer<typeof unregisterPushDeviceSchema>;

// PATCH auth/language (Phase 14).
export const setLanguageSchema = z.object({
  language: z.nativeEnum(Language),
});
export type SetLanguageInput = z.infer<typeof setLanguageSchema>;

// Salon photo by URL. Binary upload is not wired (no object storage is configured), so an owner
// points at an image they already host — their Google Business profile, Instagram, or a CDN.
//
// https only, deliberately: http would be blocked as mixed content on an https page, and
// javascript:/data: URLs are rejected outright rather than trusted to be inert in an <img src>.
// The backend never fetches this URL — only the visitor's browser does — so this is not an SSRF
// surface; the check is about what we are willing to render and store.
export const salonPhotoUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'Enter a full https:// image link');

export const createSalonPhotoSchema = z.object({
  url: salonPhotoUrlSchema,
  // Real alt text matters for accessibility and SEO; optional because a forced field invites
  // owners to type junk just to get past it.
  altText: z.string().trim().max(200).optional(),
  type: z.nativeEnum(PhotoType),
});
export type CreateSalonPhotoInput = z.infer<typeof createSalonPhotoSchema>;

// Multipart upload metadata (dashboard/salons/:salonId/photos/upload). Same altText/type fields
// as createSalonPhotoSchema above, minus `url` — on this path the URL is produced by object
// storage after the bytes land, never supplied by the client. Everything arrives as a string in
// a multipart body, so `type` is validated against the enum rather than assumed.
export const salonPhotoUploadMetaSchema = z.object({
  altText: z.string().trim().max(200).optional(),
  type: z.nativeEnum(PhotoType),
});
export type SalonPhotoUploadMetaInput = z.infer<typeof salonPhotoUploadMetaSchema>;

export const createSalonChairSchema = z.object({
  label: z.string().min(1).max(60),
});
export type CreateSalonChairInput = z.infer<typeof createSalonChairSchema>;

// Chairs are deactivated (INACTIVE/MAINTENANCE), never deleted — Chair is foreign-keyed from
// ServiceSession/QueueEntry. Only ACTIVE chairs count toward bookable capacity.
export const updateSalonChairSchema = z
  .object({
    label: z.string().min(1).max(60).optional(),
    status: z.nativeEnum(ChairStatus).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateSalonChairInput = z.infer<typeof updateSalonChairSchema>;

// POST dashboard/salons/:salonId/staff — onboard a barber. Phone is the required stable contact;
// email is optional and enables the existing password invitation flow. MVP is BARBER-only (see
// ARCHITECTURE.md §22): MANAGER exists in the schema but carries no distinct permissions yet.
export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, 'Use international format, e.g. +919876543210');

export const createSalonStaffSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  phone: e164PhoneSchema,
  email: z.string().trim().email().optional(),
});
export type CreateSalonStaffInput = z.infer<typeof createSalonStaffSchema>;

// Phase 17 (Barber Professional Profile) — bio/photoUrl accept '' as an explicit "clear this
// field" signal (SalonStaffService maps '' -> null); omitting the key entirely means "leave
// unchanged", same convention as every other partial-update schema in this file.
export const updateSalonStaffSchema = z
  .object({
    displayName: z.string().min(1).max(120).optional(),
    status: z.nativeEnum(StaffMemberStatus).optional(),
    bio: z.string().trim().max(500).optional(),
    photoUrl: z.union([salonPhotoUrlSchema, z.literal('')]).optional(),
    yearsExperience: z.number().int().min(0).max(80).optional(),
    // Launch-fixes (Issue 6) — display-only commercial tier ("Standard"/"Premium"/"Elite" or
    // anything the owner types). '' clears it, same convention as bio/photoUrl above.
    level: z.string().trim().max(40).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateSalonStaffInput = z.infer<typeof updateSalonStaffSchema>;

// PUT dashboard/salons/:salonId/staff/:staffId/services/:serviceId/pricing — owner sets or clears
// a per-staff price/duration override for one specific service. Both null clears any existing
// override entirely (reverts to the service's own plain price/duration for this barber).
export const staffServicePricingSchema = z.object({
  priceOverride: z.number().min(0).max(1_000_000).nullable(),
  durationOverrideMinutes: z.number().int().min(5).max(600).nullable(),
});
export type StaffServicePricingInput = z.infer<typeof staffServicePricingSchema>;

// PATCH dashboard/salons/:salonId/status — owner self-activation. Deliberately restricted to
// ACTIVE/SUSPENDED: an owner may open or pause their own shop, but cannot move it back to
// PENDING (a moderation state owned by the platform, not the shop).
export const updateSalonStatusSchema = z.object({
  status: z.enum([SalonStatus.ACTIVE, SalonStatus.SUSPENDED]),
});
export type UpdateSalonStatusInput = z.infer<typeof updateSalonStatusSchema>;

// PATCH dashboard/salons/:salonId/timezone — owner-set IANA timezone (Global timezone
// correctness). Real validity (a name Intl actually recognizes, e.g. "Asia/Kolkata" not
// "IST"/"UTC+5:30") can only be checked with Intl.DateTimeFormat, which isn't available inside a
// zod schema in a platform-portable way — this only checks shape (non-empty, plausible
// "Area/Location" form); SalonTimezoneService.updateTimezone is the real, server-side authority via
// isValidTimeZone, and rejects anything this shape check lets through but Intl doesn't recognize.
export const updateSalonTimezoneSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_+-]+\/[A-Za-z0-9_+\-/]+$/, 'Enter a valid IANA time zone, e.g. Asia/Kolkata'),
});
export type UpdateSalonTimezoneInput = z.infer<typeof updateSalonTimezoneSchema>;

// POST premium/dev/activate — dev/test-only Premium activation for the calling user. The backend
// route itself is unreachable outside a non-production environment (see PremiumController); this
// schema only validates shape, not who's allowed to call it.
export const devActivatePremiumSchema = z.object({
  planId: z.enum(PREMIUM_PLAN_IDS),
});
export type DevActivatePremiumInput = z.infer<typeof devActivatePremiumSchema>;

// ---------- Ratings & Reviews (Phase 16) ----------

// POST reviews — one review per booking (Review.bookingId is @unique; ReviewsService's own
// re-check gives a friendlier ALREADY_REVIEWED error before the DB constraint would).
export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

// PATCH reviews/:id — both fields optional (edit just the rating, or just the comment), but at
// least one must actually change something, same convention as updateSalonStaffSchema above.
export const updateReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.rating !== undefined || v.comment !== undefined, { message: 'No fields to update' });
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;

// PUT dashboard/salons/:salonId/reviews/:reviewId/response — owner's reply. Required non-empty:
// an owner clearing a response entirely isn't a real use case worth a separate DELETE route.
export const respondToReviewSchema = z.object({
  ownerResponse: z.string().trim().min(1).max(1000),
});
export type RespondToReviewInput = z.infer<typeof respondToReviewSchema>;

// ---------- Verification (Phase 18) ----------

// POST dashboard/salons/:salonId/verification and .../staff/:staffId/verification — evidence is
// free text plus a bounded list of already-hosted https links (salonPhotoUrlSchema), never a file
// upload (no object storage configured — same convention as Salon photos/SalonStaff.photoUrl).
// Both fields optional individually, but at least one must carry real content: a request with
// neither notes nor links gives the reviewing admin nothing to actually review.
export const submitVerificationSchema = z
  .object({
    evidenceNotes: z.string().trim().max(2000).optional(),
    evidenceUrls: z.array(salonPhotoUrlSchema).max(10).optional(),
  })
  .refine((v) => !!v.evidenceNotes || (v.evidenceUrls && v.evidenceUrls.length > 0), {
    message: 'Add a note or at least one evidence link',
  });
export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>;

// POST admin/verification/:id/decide — reviewNotes required on REJECTED (the owner needs to know
// what to fix before resubmitting); optional on APPROVED.
export const decideVerificationSchema = z
  .object({
    decision: z.enum([VerificationStatus.APPROVED, VerificationStatus.REJECTED]),
    reviewNotes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.decision !== VerificationStatus.REJECTED || !!v.reviewNotes, {
    message: 'A reason is required when rejecting a verification request',
    path: ['reviewNotes'],
  });
export type DecideVerificationInput = z.infer<typeof decideVerificationSchema>;
