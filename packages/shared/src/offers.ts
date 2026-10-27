import { z } from "zod";

export const OFFER_KINDS = ["OFFER", "PROMOTION", "DAILY_DEAL"] as const;
export const OFFER_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"] as const;
export const OFFER_DISCOUNT_TYPES = ["PERCENT", "FLAT"] as const;
export const OFFER_AUDIENCES = ["ALL", "NEW", "REPEAT", "INACTIVE"] as const;

const serviceIdsSchema = z
  .array(z.string().uuid())
  .max(100)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Service IDs must be unique.",
  );

/** "HH:mm", 24-hour, salon-local wall time. */
export const OFFER_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const offerBaseSchema = z.object({
  kind: z.enum(OFFER_KINDS),
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  discountType: z.enum(OFFER_DISCOUNT_TYPES),
  discountValue: z
    .number()
    .finite()
    .positive()
    .max(99_999_999.99)
    .multipleOf(0.01),
  audience: z.enum(OFFER_AUDIENCES).default("ALL"),
  inactiveDays: z.number().int().min(1).max(365).optional(),
  validFrom: z.string().datetime(),
  validTo: z.string().datetime(),
  maxRedemptions: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .nullable()
    .optional(),
  perCustomerLimit: z.number().int().positive().max(100).default(1),
  serviceIds: serviceIdsSchema.default([]),
  // Booking rules (all optional, so existing offers keep working unchanged):
  // minimum total of the booked services, a cap on the discount (percentage offers), and Happy
  // Hours — the salon-local weekdays (0 = Sunday) and daily time window the APPOINTMENT must fall in.
  minimumBookingAmount: z
    .number()
    .finite()
    .positive()
    .max(99_999_999.99)
    .multipleOf(0.01)
    .nullable()
    .optional(),
  maximumDiscountAmount: z
    .number()
    .finite()
    .positive()
    .max(99_999_999.99)
    .multipleOf(0.01)
    .nullable()
    .optional(),
  applicableDays: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .refine((days) => new Set(days).size === days.length, "Days must be unique.")
    .default([]),
  dailyStartTime: z.string().regex(OFFER_TIME_PATTERN).nullable().optional(),
  dailyEndTime: z.string().regex(OFFER_TIME_PATTERN).nullable().optional(),
});

const validateOffer = (
  value: z.infer<typeof offerBaseSchema>,
  ctx: z.RefinementCtx,
) => {
  if (Date.parse(value.validTo) <= Date.parse(value.validFrom)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["validTo"],
      message: "validTo must be after validFrom.",
    });
  }
  if (
    value.discountType === "PERCENT" &&
    (value.discountValue > 100 || !Number.isInteger(value.discountValue))
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["discountValue"],
      message: "Percentage discounts must be whole numbers from 1 to 100.",
    });
  }
  if (value.audience === "INACTIVE" && value.inactiveDays === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inactiveDays"],
      message: "inactiveDays is required for the INACTIVE audience.",
    });
  }
  if (!value.dailyStartTime !== !value.dailyEndTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dailyEndTime"],
      message: "Set both a start and an end time, or neither.",
    });
  }
  if (value.dailyStartTime && value.dailyEndTime && value.dailyStartTime >= value.dailyEndTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dailyEndTime"],
      message: "The end time must be after the start time.",
    });
  }
  if (value.discountType === "FLAT" && value.maximumDiscountAmount != null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maximumDiscountAmount"],
      message: "A maximum discount only applies to percentage offers.",
    });
  }
  if (value.audience !== "INACTIVE" && value.inactiveDays !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inactiveDays"],
      message: "inactiveDays is only valid for the INACTIVE audience.",
    });
  }
};

export const createOfferSchema = offerBaseSchema.superRefine(validateOffer);
export type CreateOfferInput = z.infer<typeof createOfferSchema>;

export const updateOfferSchema = offerBaseSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });
export type UpdateOfferInput = z.infer<typeof updateOfferSchema>;

export const offerPreviewSchema = z.object({
  serviceIds: z
    .array(z.string().uuid())
    .min(1)
    .max(100)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Service IDs must be unique.",
    ),
});
export type OfferPreviewInput = z.infer<typeof offerPreviewSchema>;

export const offerListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]).optional(),
  kind: z.enum(OFFER_KINDS).optional(),
});
export type OfferListQuery = z.infer<typeof offerListQuerySchema>;

export const publicOfferQuerySchema = z.object({
  /** Legacy city-slug filter retained for existing clients. */
  city: z.string().trim().min(1).max(120).optional(),
  /** Canonical location filter for public links: pair countryCode with citySlug. */
  countryCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase())
    .optional(),
  citySlug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(120)
    .optional(),
  service: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().uuid().optional(),
});
export type PublicOfferQuery = z.infer<typeof publicOfferQuerySchema>;

export const OfferErrorCode = {
  NOT_FOUND: "OFFER_NOT_FOUND",
  INVALID: "OFFER_INVALID",
  EXPIRED: "OFFER_EXPIRED",
  NOT_ELIGIBLE: "OFFER_NOT_ELIGIBLE",
  REDEMPTION_LIMIT: "OFFER_REDEMPTION_LIMIT",
  SERVICE_MISMATCH: "OFFER_SERVICE_MISMATCH",
  NOT_PUBLISHABLE: "OFFER_NOT_PUBLISHABLE",
  MUST_PAUSE_TO_EDIT: "OFFER_MUST_PAUSE_TO_EDIT",
  CHANGED_RETRY: "OFFER_CHANGED_RETRY",
} as const;
export type OfferErrorCode =
  (typeof OfferErrorCode)[keyof typeof OfferErrorCode];

export interface OfferDto {
  id: string;
  salonId: string;
  kind: (typeof OFFER_KINDS)[number];
  status: (typeof OFFER_STATUSES)[number];
  title: string;
  description: string | null;
  discountType: (typeof OFFER_DISCOUNT_TYPES)[number];
  discountValue: number;
  currency: string;
  audience: (typeof OFFER_AUDIENCES)[number];
  inactiveDays: number | null;
  validFrom: string;
  validTo: string;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  serviceIds: string[];
  minimumBookingAmount: number | null;
  maximumDiscountAmount: number | null;
  applicableDays: number[];
  dailyStartTime: string | null;
  dailyEndTime: string | null;
  redemptionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OfferPriceLineDto {
  serviceId: string;
  serviceName: string;
  basePrice: number;
  discount: number;
  finalPrice: number;
  currency: string;
}

export interface OfferPreviewDto {
  offerId: string | null;
  currency: string;
  eligibleByRule: boolean | null;
  eligibilityRule: (typeof OFFER_AUDIENCES)[number];
  lines: OfferPriceLineDto[];
  subtotal: number;
  discount: number;
  finalTotal: number;
}

export interface PublicOfferDto extends Omit<
  OfferDto,
  "salonId" | "redemptionCount"
> {
  salon: {
    id: string;
    name: string;
    slug: string;
    city: string;
    countryCode: string;
    citySlug: string;
  };
  eligibility: {
    audience: (typeof OFFER_AUDIENCES)[number];
    accountRequired: boolean;
  };
  prices: OfferPriceLineDto[];
}

export interface OfferRedemptionStatsDto {
  offerId: string;
  redemptionCount: number;
  uniqueCustomers: number;
  completedBookings: number;
  cancelledBookings: number;
  recordedDiscount: number;
  currency: string;
}

// ── Offer booking rules shared by the booking validation (server) and the search display ──

export interface OfferSchedule {
  applicableDays: number[];
  dailyStartTime: string | null;
  dailyEndTime: string | null;
}

/** True when the offer only applies on some days or at some times (Happy Hours). */
export function offerHasSchedule(schedule: OfferSchedule): boolean {
  return schedule.applicableDays.length > 0 || !!(schedule.dailyStartTime && schedule.dailyEndTime);
}

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

/**
 * Whether an appointment at this salon-local weekday (0 = Sunday) and minute of day falls inside
 * the offer's schedule. The window is start-inclusive, end-exclusive.
 */
export function offerScheduleApplies(schedule: OfferSchedule, localDayOfWeek: number, localMinutes: number): boolean {
  if (schedule.applicableDays.length > 0 && !schedule.applicableDays.includes(localDayOfWeek)) return false;
  if (schedule.dailyStartTime && schedule.dailyEndTime) {
    return localMinutes >= minutesOf(schedule.dailyStartTime) && localMinutes < minutesOf(schedule.dailyEndTime);
  }
  return true;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Fri, 14:00–17:00" style summary of an offer's schedule, or null when it has none. */
export function describeOfferSchedule(schedule: OfferSchedule): string | null {
  if (!offerHasSchedule(schedule)) return null;
  const days = [...schedule.applicableDays].sort((a, b) => a - b);
  const weekdays = days.length === 5 && days.every((day, index) => day === index + 1);
  const dayText = days.length === 0 ? "" : weekdays ? "Mon–Fri" : days.map((day) => DAY_SHORT[day]).join(", ");
  const timeText = schedule.dailyStartTime && schedule.dailyEndTime ? `${schedule.dailyStartTime}–${schedule.dailyEndTime}` : "";
  return [dayText, timeText].filter(Boolean).join(", ");
}
