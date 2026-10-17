import { z } from "zod";

/** Owner-only salon inventory API path segments. */
export const INVENTORY_PATHS = {
  root: "inventory",
  categories: "categories",
  suppliers: "suppliers",
  products: "products",
  movements: "movements",
  report: "report",
} as const;

export const InventoryUnit = {
  EACH: "EACH",
  GRAM: "GRAM",
  KILOGRAM: "KILOGRAM",
  MILLILITER: "MILLILITER",
  LITER: "LITER",
  PACK: "PACK",
  BOX: "BOX",
  OTHER: "OTHER",
} as const;
export type InventoryUnit = (typeof InventoryUnit)[keyof typeof InventoryUnit];

export const InventoryMovementKind = {
  OPENING: "OPENING",
  PURCHASE: "PURCHASE",
  CONSUMPTION: "CONSUMPTION",
  ADJUSTMENT: "ADJUSTMENT",
} as const;
export type InventoryMovementKind =
  (typeof InventoryMovementKind)[keyof typeof InventoryMovementKind];

export const InventoryErrorCode = {
  CATEGORY_EXISTS: "INVENTORY_CATEGORY_EXISTS",
  SUPPLIER_EXISTS: "INVENTORY_SUPPLIER_EXISTS",
  PRODUCT_EXISTS: "INVENTORY_PRODUCT_EXISTS",
  PRODUCT_NOT_FOUND: "INVENTORY_PRODUCT_NOT_FOUND",
  CATEGORY_NOT_FOUND: "INVENTORY_CATEGORY_NOT_FOUND",
  SUPPLIER_NOT_FOUND: "INVENTORY_SUPPLIER_NOT_FOUND",
  INSUFFICIENT_STOCK: "INVENTORY_INSUFFICIENT_STOCK",
  IDEMPOTENCY_KEY_REQUIRED: "INVENTORY_IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_REUSED: "INVENTORY_IDEMPOTENCY_KEY_REUSED",
  CURSOR_FILTER_MISMATCH: "CURSOR_FILTER_MISMATCH",
  OPENING_ALREADY_RECORDED: "INVENTORY_OPENING_ALREADY_RECORDED",
  INVALID_MOVEMENT: "INVENTORY_INVALID_MOVEMENT",
} as const;

const name = (max: number) => z.string().trim().min(1).max(max);
const positiveQuantity = z
  .number()
  .finite()
  .positive()
  .max(999999999.999)
  .multipleOf(0.001);
const nonNegativeMoney = z
  .number()
  .finite()
  .nonnegative()
  .max(9999999999.99)
  .multipleOf(0.01);

export const createInventoryCategorySchema = z
  .object({
    name: name(80),
  })
  .strict();
export type CreateInventoryCategoryInput = z.infer<
  typeof createInventoryCategorySchema
>;

export const createInventorySupplierSchema = z
  .object({
    name: name(120),
    contactName: z.string().trim().max(120).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    email: z.string().trim().email().max(254).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();
export type CreateInventorySupplierInput = z.infer<
  typeof createInventorySupplierSchema
>;

export const createInventoryProductSchema = z
  .object({
    name: name(120),
    sku: z.string().trim().min(1).max(80).optional().nullable(),
    unit: z.nativeEnum(InventoryUnit),
    categoryId: z.string().uuid().optional().nullable(),
    supplierId: z.string().uuid().optional().nullable(),
    isActive: z.boolean().optional(),
    reorderThreshold: z
      .number()
      .finite()
      .nonnegative()
      .max(999999999.999)
      .multipleOf(0.001)
      .default(0),
  })
  .strict();
export type CreateInventoryProductInput = z.infer<
  typeof createInventoryProductSchema
>;

export const updateInventoryProductSchema = createInventoryProductSchema
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );
export type UpdateInventoryProductInput = z.infer<
  typeof updateInventoryProductSchema
>;

export const createInventoryMovementSchema = z
  .object({
    kind: z.nativeEnum(InventoryMovementKind),
    quantity: positiveQuantity,
    unitCost: nonNegativeMoney.optional(),
    supplierId: z.string().uuid().optional().nullable(),
    adjustmentDirection: z.enum(["INCREASE", "DECREASE"]).optional(),
    reason: z.string().trim().max(300).optional(),
    reference: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (
      value.kind === InventoryMovementKind.OPENING ||
      value.kind === InventoryMovementKind.PURCHASE
    ) {
      if (value.unitCost === undefined)
        fail("unitCost", "A unit cost is required for incoming stock");
      if (value.adjustmentDirection !== undefined)
        fail("adjustmentDirection", "Not valid for this movement");
    }
    if (value.kind === InventoryMovementKind.OPENING && value.supplierId) {
      fail(
        "supplierId",
        "Opening stock cannot be attributed to a purchase supplier",
      );
    }
    if (
      value.kind === InventoryMovementKind.PURCHASE &&
      value.adjustmentDirection !== undefined
    ) {
      fail("adjustmentDirection", "Not valid for a purchase");
    }
    if (value.kind === InventoryMovementKind.CONSUMPTION) {
      if (value.unitCost !== undefined)
        fail("unitCost", "Consumption cost is derived from stock valuation");
      if (value.supplierId)
        fail("supplierId", "Consumption cannot be attributed to a supplier");
      if (value.adjustmentDirection !== undefined)
        fail("adjustmentDirection", "Not valid for consumption");
    }
    if (value.kind === InventoryMovementKind.ADJUSTMENT) {
      if (value.adjustmentDirection === undefined)
        fail("adjustmentDirection", "Adjustment direction is required");
      if (!value.reason)
        fail("reason", "A reason is required for stock adjustments");
      if (value.unitCost !== undefined)
        fail("unitCost", "Adjustment cost is derived from stock valuation");
      if (value.supplierId)
        fail("supplierId", "Adjustment cannot be attributed to a supplier");
    }
  });
export type CreateInventoryMovementInput = z.infer<
  typeof createInventoryMovementSchema
>;

const inventoryPaginationQueryShape = {
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
};

export const inventoryProductListQuerySchema = z
  .object({
    ...inventoryPaginationQueryShape,
    categoryId: z.string().uuid().optional(),
    lowStock: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();
export type InventoryProductListQuery = z.infer<
  typeof inventoryProductListQuerySchema
>;

export const inventoryMovementListQuerySchema = z
  .object({
    ...inventoryPaginationQueryShape,
    productId: z.string().uuid().optional(),
    kind: z.nativeEnum(InventoryMovementKind).optional(),
  })
  .strict();
export type InventoryMovementListQuery = z.infer<
  typeof inventoryMovementListQuerySchema
>;

export const inventoryLookupListQuerySchema = z
  .object({
    cursor: z.string().trim().min(1).max(1024).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type InventoryLookupListQuery = z.infer<
  typeof inventoryLookupListQuerySchema
>;

export interface InventoryCategoryDto {
  id: string;
  salonId: string;
  name: string;
  createdAt: string;
}

export interface InventorySupplierDto {
  id: string;
  salonId: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  createdAt: string;
}

export interface InventoryProductDto {
  id: string;
  salonId: string;
  name: string;
  sku: string | null;
  unit: InventoryUnit;
  stockOnHand: string;
  averageUnitCost: string;
  reorderThreshold: string;
  isLowStock: boolean;
  isActive: boolean;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string } | null;
  updatedAt: string;
}

export interface InventoryMovementDto {
  id: string;
  salonId: string;
  productId: string;
  productName: string;
  sku: string | null;
  kind: InventoryMovementKind;
  quantityDelta: string;
  unitCost: string | null;
  stockAfter: string;
  averageUnitCostAfter: string;
  supplier: { id: string; name: string } | null;
  actorUserId: string;
  reason: string | null;
  reference: string | null;
  recordedAt: string;
}

export interface InventoryPageDto<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface InventoryReportDto {
  productCount: number;
  lowStockCount: number;
  estimatedStockValue: string;
  valuationBasis: "weighted-average-cost";
  currency: string | null;
  movementCounts: Record<InventoryMovementKind, number>;
  lowStockProducts: InventoryProductDto[];
}
