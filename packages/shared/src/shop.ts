import { z } from "zod";

// FastQue Marketplace — the public beauty marketplace. One master product (global_products) can be
// sold by many salons, each through its own listing on its own inventory row. Prices, stock and
// order permissions are always decided by the server; nothing here trusts a client value.

export const SHOP_BRAND_NAME = "Marketplace";

export const SHOP_PATHS = {
  /** Public: shop/... */
  root: "shop",
  home: "home",
  products: "products",
  facets: "facets",
  quote: "cart/quote",
  orders: "orders",
  cancel: "cancel",
  /** Signed-in customer: customer/shop/... */
  customer: "customer/shop",
  wishlist: "wishlist",
  /** Owner: dashboard/salons/:salonId/shop/... */
  owner: "shop",
  listings: "listings",
  sellable: "sellable",
  analytics: "analytics",
  transition: "transition",
  /** Admin: admin/shop/... */
  admin: "shop",
  stats: "stats",
} as const;

export const ShopListingStatus = {
  DRAFT: "DRAFT",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
} as const;
export type ShopListingStatus = (typeof ShopListingStatus)[keyof typeof ShopListingStatus];

export const ShopOrderStatus = {
  PLACED: "PLACED",
  ACCEPTED: "ACCEPTED",
  PREPARING: "PREPARING",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;
export type ShopOrderStatus = (typeof ShopOrderStatus)[keyof typeof ShopOrderStatus];

/** Statuses whose items still hold (reserve) the salon's stock. */
export const SHOP_RESERVING_STATUSES: readonly ShopOrderStatus[] = ["PLACED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP"];

/** The only status changes allowed, and who may make each one. */
export const SHOP_ORDER_TRANSITIONS: Record<ShopOrderStatus, Partial<Record<ShopOrderStatus, ReadonlyArray<"SELLER" | "CUSTOMER" | "SYSTEM" | "ADMIN">>>> = {
  PLACED: { ACCEPTED: ["SELLER"], CANCELLED: ["SELLER", "CUSTOMER", "ADMIN"], EXPIRED: ["SYSTEM"] },
  ACCEPTED: { PREPARING: ["SELLER"], READY_FOR_PICKUP: ["SELLER"], CANCELLED: ["SELLER", "ADMIN"] },
  PREPARING: { READY_FOR_PICKUP: ["SELLER"], CANCELLED: ["SELLER", "ADMIN"] },
  READY_FOR_PICKUP: { COMPLETED: ["SELLER"], CANCELLED: ["SELLER", "ADMIN"] },
  COMPLETED: {},
  CANCELLED: {},
  EXPIRED: {},
};
export function canTransition(from: ShopOrderStatus, to: ShopOrderStatus, actor: "SELLER" | "CUSTOMER" | "SYSTEM" | "ADMIN"): boolean {
  return !!SHOP_ORDER_TRANSITIONS[from]?.[to]?.includes(actor);
}

export const SHOP_ORDER_STATUS_LABEL: Record<ShopOrderStatus, string> = {
  PLACED: "Placed — waiting for the salon",
  ACCEPTED: "Accepted by the salon",
  PREPARING: "Being prepared",
  READY_FOR_PICKUP: "Ready for pickup",
  COMPLETED: "Collected",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired (not accepted in time)",
};

/** Hours a salon has to accept a new order before it expires and releases the stock. */
export const SHOP_ACCEPT_WINDOW_HOURS = 24;
export const SHOP_MAX_CART_LINES = 20;

/** The categories shown as tiles; each maps to catalog category names (case-insensitive). */
export const SHOP_CATEGORIES: ReadonlyArray<{ slug: string; label: string; emoji: string; match: string[] }> = [
  { slug: "hair-care", label: "Hair Care", emoji: "💆", match: ["hair care", "hair color", "hair colour"] },
  { slug: "skin-care", label: "Skin Care", emoji: "🧴", match: ["skin care", "facial & spa", "facial and spa", "body care"] },
  { slug: "makeup", label: "Makeup", emoji: "💄", match: ["makeup", "make up", "cosmetics"] },
  { slug: "mens-grooming", label: "Men's Grooming", emoji: "🪒", match: ["shaving & beard", "shaving and beard", "men's grooming", "mens grooming", "beard"] },
  { slug: "fragrances", label: "Fragrances", emoji: "🌸", match: ["fragrance", "fragrances", "perfume"] },
  { slug: "nail-care", label: "Nail Care", emoji: "💅", match: ["nail care", "nails"] },
  { slug: "hair-styling", label: "Hair Styling", emoji: "✨", match: ["hair styling", "styling tools", "hair styling tools"] },
  { slug: "salon-pro", label: "Salon Pro", emoji: "✂️", match: ["salon consumables", "salon equipment", "professional", "salon pro"] },
  { slug: "waxing", label: "Waxing & Removal", emoji: "🌿", match: ["waxing & hair removal", "waxing and hair removal", "waxing"] },
  { slug: "offers", label: "Offers & Combos", emoji: "🎁", match: [] },
];

/** Search synonyms: a query word also matches these words (deterministic, explainable). */
export const SHOP_SYNONYMS: Record<string, string[]> = {
  shampoo: ["shampoo", "cleanser"],
  "face wash": ["face wash", "cleanser", "facial cleanser"],
  facewash: ["face wash", "cleanser"],
  serum: ["serum", "essence"],
  moisturizer: ["moisturizer", "moisturiser", "cream", "lotion"],
  moisturiser: ["moisturizer", "moisturiser", "cream", "lotion"],
  conditioner: ["conditioner", "hair mask", "leave-in"],
  men: ["men", "beard", "shaving", "grooming"],
  mens: ["men", "beard", "shaving", "grooming"],
  beard: ["beard", "shaving"],
  sunscreen: ["sunscreen", "spf", "sun"],
  lipstick: ["lipstick", "lip color", "lip colour", "lip"],
  perfume: ["perfume", "fragrance", "mist", "deo"],
  gel: ["gel", "pomade", "wax"],
  color: ["color", "colour", "dye"],
  colour: ["color", "colour", "dye"],
};

/** Words of a search query expanded with synonyms; every group must match something. */
export function expandShopQuery(q: string): string[][] {
  const text = q.toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return [];
  const groups: string[][] = [];
  let rest = text;
  for (const phrase of Object.keys(SHOP_SYNONYMS).filter((k) => k.includes(" "))) {
    if (rest.includes(phrase)) {
      groups.push(SHOP_SYNONYMS[phrase]);
      rest = rest.replace(phrase, " ");
    }
  }
  for (const word of rest.split(" ").filter((w) => w.length >= 2)) groups.push(SHOP_SYNONYMS[word] ?? [word]);
  return groups.slice(0, 6);
}

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Rupees as integer paise, so totals never drift (decimal-safe). */
export const toPaise = (rupees: string | number) => Math.round(Number(rupees) * 100);
export const fromPaise = (paise: number) => (paise / 100).toFixed(2);

// ---------- Schemas ----------

const coord = z.coerce.number().finite();
export const shopProductsQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    category: z.string().trim().max(40).optional(),
    brand: z.string().trim().max(120).optional(),
    minPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    maxPrice: z.coerce.number().min(0).max(1_000_000).optional(),
    availableOnly: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    onSale: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    salonId: z.string().uuid().optional(),
    sort: z.enum(["relevance", "price_asc", "price_desc", "nearest", "popular", "newest"]).default("relevance"),
    lat: coord.min(-90).max(90).optional(),
    lng: coord.min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(500).optional(),
    /** Only salons in this city (slug), e.g. when the shopper picked a city instead of sharing GPS. */
    city: z.string().trim().regex(/^[a-z0-9-]{1,80}$/).optional(),
    page: z.coerce.number().int().min(1).max(500).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(24),
  })
  .strict();
export type ShopProductsQuery = z.infer<typeof shopProductsQuerySchema>;

export const shopProductDetailQuerySchema = z
  .object({ lat: coord.min(-90).max(90).optional(), lng: coord.min(-180).max(180).optional(), city: z.string().trim().regex(/^[a-z0-9-]{1,80}$/).optional() })
  .strict();
export type ShopProductDetailQuery = z.infer<typeof shopProductDetailQuerySchema>;

const cartLine = z.object({ listingId: z.string().uuid(), quantity: z.number().int().min(1).max(50) }).strict();
export const shopCartQuoteSchema = z.object({ items: z.array(cartLine).min(1).max(SHOP_MAX_CART_LINES) }).strict();
export type ShopCartQuoteInput = z.infer<typeof shopCartQuoteSchema>;

export const shopCheckoutSchema = z
  .object({
    items: z.array(cartLine).min(1).max(SHOP_MAX_CART_LINES),
    contactName: z.string().trim().min(2).max(120),
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s-]{7,17}$/, "Enter a valid phone number"),
    contactEmail: z.string().trim().email().max(254).optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
    fulfillment: z.literal("PICKUP").default("PICKUP"),
    paymentMethod: z.literal("PAY_AT_SALON").default("PAY_AT_SALON"),
    /** The prices the customer saw; the order is refused if the server's prices differ. */
    expectedTotal: z.string().regex(/^\d+(\.\d{1,2})?$/),
  })
  .strict();
export type ShopCheckoutInput = z.infer<typeof shopCheckoutSchema>;

export const shopOrderAccessQuerySchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,80}$/) }).strict();

export const ownerListingUpsertSchema = z
  .object({
    inventoryProductId: z.string().uuid(),
    price: z.number().finite().positive().max(1_000_000).multipleOf(0.01),
    compareAtPrice: z.number().finite().positive().max(1_000_000).multipleOf(0.01).optional().nullable(),
    maxPerOrder: z.number().int().min(1).max(50).default(5),
    pickupEnabled: z.boolean().default(true),
  })
  .strict()
  .refine((v) => v.compareAtPrice == null || v.compareAtPrice >= v.price, { message: "The original price must be at least the selling price.", path: ["compareAtPrice"] });
export type OwnerListingUpsertInput = z.infer<typeof ownerListingUpsertSchema>;

export const ownerListingStatusSchema = z.object({ action: z.enum(["PAUSE", "RESUME", "SUBMIT"]) }).strict();
export type OwnerListingStatusInput = z.infer<typeof ownerListingStatusSchema>;

export const shopOrderTransitionSchema = z
  .object({
    to: z.nativeEnum(ShopOrderStatus),
    note: z.string().trim().max(300).optional(),
    /** Seller confirms the customer paid at the salon when marking COMPLETED. */
    paidAtSalon: z.boolean().optional(),
  })
  .strict();
export type ShopOrderTransitionInput = z.infer<typeof shopOrderTransitionSchema>;

export const shopOrderListQuerySchema = z
  .object({
    status: z.nativeEnum(ShopOrderStatus).optional(),
    salonId: z.string().uuid().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ShopOrderListQuery = z.infer<typeof shopOrderListQuerySchema>;

export const shopAnalyticsQuerySchema = z.object({ period: z.enum(["day", "week", "month"]).default("week") }).strict();
export type ShopAnalyticsQuery = z.infer<typeof shopAnalyticsQuerySchema>;

export const adminListingReviewSchema = z
  .object({ action: z.enum(["APPROVE", "REJECT", "PAUSE"]), note: z.string().trim().max(300).optional() })
  .strict()
  .refine((v) => v.action !== "REJECT" || !!v.note, { message: "Say why the listing is rejected.", path: ["note"] });
export type AdminListingReviewInput = z.infer<typeof adminListingReviewSchema>;

export const adminListingQuerySchema = z
  .object({
    status: z.nativeEnum(ShopListingStatus).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AdminListingQuery = z.infer<typeof adminListingQuerySchema>;

// ---------- DTOs ----------

export interface ShopOfferDto {
  listingId: string;
  salon: { id: string; name: string; city: string | null; locality: string | null; slug: string };
  price: string;
  compareAtPrice: string | null;
  discountPercent: number | null;
  /** Derived from the salon's real stock minus open orders — never a made-up number. */
  availability: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
  availableQuantity: number;
  maxPerOrder: number;
  pickup: boolean;
  delivery: boolean;
  distanceKm: number | null;
}

export interface ShopProductCardDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  variant: string | null;
  imageUrl: string | null;
  isTestData: boolean;
  barcode: string | null;
  mrp: string | null;
  /** Lowest current price across salons with stock; null when no salon sells it yet. */
  fromPrice: string | null;
  compareAtPrice: string | null;
  discountPercent: number | null;
  /** Biggest discount any in-stock salon offers (a product is "on offer" when this is > 0). */
  maxDiscountPercent: number | null;
  sellerCount: number;
  inStock: boolean;
  nearestKm: number | null;
}

export interface ShopProductDetailDto extends ShopProductCardDto {
  description: string | null;
  subcategory: string | null;
  manufacturer: string | null;
  packSize: string | null;
  packUnit: string | null;
  barcodes: Array<{ display: string; symbology: string }>;
  offers: ShopOfferDto[];
  related: ShopProductCardDto[];
}

export interface ShopHomeDto {
  categories: Array<{ slug: string; label: string; emoji: string; products: number }>;
  availableNow: ShopProductCardDto[];
  onSale: ShopProductCardDto[];
  popular: ShopProductCardDto[];
  newArrivals: ShopProductCardDto[];
  stats: { products: number; sellingSalons: number; listedProducts: number };
}

export interface ShopFacetsDto {
  categories: Array<{ slug: string; label: string; products: number }>;
  brands: Array<{ name: string; products: number }>;
  priceRange: { min: string; max: string } | null;
}

export interface ShopProductPageDto {
  /** True when no product matched every word, so products matching any word are shown. */
  relaxed?: boolean;
  items: ShopProductCardDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ShopQuoteLineDto {
  listingId: string;
  productId: string;
  name: string;
  brand: string | null;
  variant: string | null;
  quantity: number;
  unitPrice: string;
  compareAtPrice: string | null;
  lineTotal: string;
  availableQuantity: number;
  maxPerOrder: number;
  problem: string | null;
}

export interface ShopQuoteDto {
  salon: { id: string; name: string; address: string | null; city: string | null } | null;
  lines: ShopQuoteLineDto[];
  subtotal: string;
  discountTotal: string;
  savings: string;
  total: string;
  currency: string;
  /** Problems that block checkout (mixed salons, out of stock, unavailable listing). */
  blocking: string[];
}

export interface ShopOrderDto {
  id: string;
  orderNumber: string;
  status: ShopOrderStatus;
  statusLabel: string;
  fulfillment: "PICKUP" | "DELIVERY";
  paymentMethod: "PAY_AT_SALON" | "ONLINE";
  paymentStatus: "UNPAID" | "PAID_AT_SALON" | "PAID_ONLINE" | "REFUNDED";
  salon: { id: string; name: string; address: string | null; city: string | null; phone: string | null };
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  note: string | null;
  items: Array<{ productId: string; name: string; brand: string | null; variant: string | null; barcode: string | null; quantity: number; unitPrice: string; lineTotal: string }>;
  subtotal: string;
  discountTotal: string;
  total: string;
  currency: string;
  placedAt: string;
  acceptBy: string;
  acceptedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  events: Array<{ toStatus: ShopOrderStatus; actorKind: string; note: string | null; at: string }>;
  allowedTransitions: ShopOrderStatus[];
}

export interface ShopCheckoutResultDto {
  order: ShopOrderDto;
  /** Secret for the guest's order link (shown once; only its hash is stored). */
  accessToken: string;
  created: boolean;
}

export interface OwnerSellableProductDto {
  inventoryProductId: string;
  name: string;
  globalProductId: string | null;
  barcode: string | null;
  usage: "PROFESSIONAL" | "RETAIL";
  stockOnHand: string;
  reserved: number;
  sellingPrice: string | null;
  listing: OwnerListingDto | null;
}

export interface OwnerListingDto {
  id: string;
  inventoryProductId: string;
  productName: string;
  price: string;
  compareAtPrice: string | null;
  maxPerOrder: number;
  pickupEnabled: boolean;
  status: ShopListingStatus;
  reviewNote: string | null;
  availableQuantity: number;
  updatedAt: string;
}

export interface ShopAnalyticsDto {
  period: "day" | "week" | "month";
  from: string;
  to: string;
  orders: number;
  completedOrders: number;
  cancelledOrders: number;
  unitsSold: number;
  grossSales: string;
  discounts: string;
  commissionPercent: string;
  commission: string;
  refunds: string;
  netProceeds: string;
  averageOrderValue: string;
  bestSellers: Array<{ productId: string; name: string; units: number; revenue: string }>;
  byStatus: Record<ShopOrderStatus, number>;
}

export interface AdminShopListingDto extends OwnerListingDto {
  salon: { id: string; name: string };
  globalProductId: string;
  barcode: string | null;
  isTestData: boolean;
  stockOnHand: string;
}

export interface AdminShopStatsDto {
  listings: Record<ShopListingStatus, number>;
  sellingSalons: number;
  orders: Record<ShopOrderStatus, number>;
  grossSales: string;
  completedOrders: number;
  commissionPercent: string;
  lowStockListings: number;
}
