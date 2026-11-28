import { z } from "zod";
import { InventoryUnit } from "./inventory";
import { gtinCheckDigit, normalizeBarcode, ProductType, type BarcodeFormat } from "./product-catalog";

// FastQue inventory master upload (admin Excel/CSV). This module is pure: header detection with
// flexible column names, per-row validation and normalization. Anything that needs the database
// (which salon a shop name means, whether a barcode already exists) is decided by the backend.

export const INVENTORY_UPLOAD_PATHS = {
  /** admin/inventory-uploads */
  uploads: "inventory-uploads",
  preview: "preview",
  commit: "commit",
  cancel: "cancel",
  issues: "issues",
  errorReport: "errors.csv",
  template: "template.csv",
  /** admin/inventory-master/stats */
  masterStats: "inventory-master/stats",
  /** admin/catalog-change-requests */
  changeRequests: "catalog-change-requests",
  /** Salon side, under dashboard/salons/:salonId/inventory/catalog/ */
  browse: "browse",
  add: "add",
  ownerChangeRequests: "change-requests",
  ownerSummary: "summary",
} as const;

export const INVENTORY_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const INVENTORY_UPLOAD_MAX_ROWS = 5000;
/** Rows returned inline with a preview; the full list is paged through the issues endpoint. */
export const INVENTORY_UPLOAD_PREVIEW_ROWS = 300;

export const CatalogVisibility = { GLOBAL: "GLOBAL", SHOP: "SHOP" } as const;
export type CatalogVisibility = (typeof CatalogVisibility)[keyof typeof CatalogVisibility];

export const InventoryUploadStatus = {
  PREVIEWED: "PREVIEWED",
  PROCESSING: "PROCESSING",
  COMPLETED: "COMPLETED",
  COMPLETED_WITH_ERRORS: "COMPLETED_WITH_ERRORS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
export type InventoryUploadStatus = (typeof InventoryUploadStatus)[keyof typeof InventoryUploadStatus];

export const UploadIssueSeverity = { ERROR: "ERROR", WARNING: "WARNING", REVIEW: "REVIEW" } as const;
export type UploadIssueSeverity = (typeof UploadIssueSeverity)[keyof typeof UploadIssueSeverity];

/**
 * What the importer does with a row. CREATE_GLOBAL / CREATE_SHOP add a master product (and, for a
 * shop row, that shop's association); LINK_SHOP reuses an existing master product and only adds the
 * shop association; UNCHANGED means it is all already there (re-imports are no-ops); SKIP / REVIEW
 * leave the row out (REVIEW = needs an admin decision, e.g. an unknown shop or a barcode conflict).
 */
export const UploadRowAction = {
  CREATE_GLOBAL: "CREATE_GLOBAL",
  CREATE_SHOP: "CREATE_SHOP",
  LINK_SHOP: "LINK_SHOP",
  UNCHANGED: "UNCHANGED",
  SKIP: "SKIP",
  REVIEW: "REVIEW",
} as const;
export type UploadRowAction = (typeof UploadRowAction)[keyof typeof UploadRowAction];

/**
 * The spec's transaction types, mapped onto the existing immutable stock ledger kinds (one ledger,
 * no parallel table). STOCK_OUT covers stock leaving for any non-service reason.
 */
export const INVENTORY_TRANSACTION_TYPES = {
  STOCK_IN: ["OPENING", "PURCHASE", "TRANSFER_IN"],
  STOCK_OUT: ["WASTAGE", "TRANSFER_OUT"],
  SERVICE_CONSUMPTION: ["CONSUMPTION"],
  ADJUSTMENT: ["ADJUSTMENT"],
  RETURN: ["RETURN"],
  DAMAGE: ["DAMAGE"],
  EXPIRY: ["EXPIRY"],
} as const;
export type InventoryTransactionType = keyof typeof INVENTORY_TRANSACTION_TYPES;
export function transactionTypeOfKind(kind: string): InventoryTransactionType {
  for (const [type, kinds] of Object.entries(INVENTORY_TRANSACTION_TYPES))
    if ((kinds as readonly string[]).includes(kind)) return type as InventoryTransactionType;
  return "ADJUSTMENT";
}

// ---------- Columns ----------

export const UPLOAD_FIELDS = [
  "barcode", "barcode_type", "barcode_image", "product_ref", "name", "brand", "manufacturer",
  "category", "subcategory", "variant", "pack_size", "pack_unit", "unit", "description", "mrp",
  "cost_price", "selling_price", "quantity", "min_stock", "shop_id", "shop_name", "visibility",
  "hsn_code", "gst_rate", "product_type", "image_url", "data_status",
] as const;
export type UploadField = (typeof UPLOAD_FIELDS)[number];

export const UPLOAD_FIELD_LABELS: Record<UploadField, string> = {
  barcode: "Barcode (EAN/UPC)",
  barcode_type: "Barcode type",
  barcode_image: "Barcode image",
  product_ref: "Product code / SKU",
  name: "Product name",
  brand: "Brand",
  manufacturer: "Manufacturer",
  category: "Category",
  subcategory: "Subcategory",
  variant: "Variant / size",
  pack_size: "Pack size",
  pack_unit: "Pack unit",
  unit: "Counting unit",
  description: "Description",
  mrp: "MRP",
  cost_price: "Cost price",
  selling_price: "Selling price",
  quantity: "Opening quantity",
  min_stock: "Minimum stock",
  shop_id: "Shop ID",
  shop_name: "Shop name",
  visibility: "Visibility (global/shop)",
  hsn_code: "HSN code",
  gst_rate: "GST rate %",
  product_type: "Professional / retail",
  image_url: "Image URL",
  data_status: "Data status / notes",
};

const key = (header: string) =>
  header
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&amp;/g, "&")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();

/** Exact header spellings (after key()) for each field. */
const EXACT: Record<string, UploadField> = {};
const alias = (field: UploadField, ...names: string[]) => names.forEach((n) => (EXACT[key(n)] = field));
alias("barcode", "barcode", "barcode number", "barcode no", "ean", "ean13", "ean 13", "ean code", "ean number", "upc", "upc code", "gtin", "bar code", "ean 13 test number");
alias("barcode_type", "barcode type", "symbology", "barcode format", "code type");
alias("barcode_image", "barcode image", "barcode picture", "barcode img");
alias("product_ref", "product id", "product code", "item code", "item id", "sku", "sku code", "article code", "article number", "ref", "reference");
alias("name", "product name", "name", "item name", "product", "item", "product title", "title");
alias("brand", "brand", "brand name", "fictional brand", "make");
alias("manufacturer", "manufacturer", "company", "maker", "marketed by");
alias("category", "category", "product category", "department");
alias("subcategory", "subcategory", "sub category", "sub-category", "segment");
alias("variant", "variant", "size", "variant size", "variant / size", "variant/size", "shade", "pack", "net quantity", "net qty");
alias("pack_size", "pack size", "content", "volume", "weight", "net content");
alias("pack_unit", "pack unit", "content unit", "volume unit");
alias("unit", "unit", "uom", "unit of measure", "counting unit", "stock unit");
alias("description", "description", "details", "product description");
alias("mrp", "mrp", "max retail price", "maximum retail price");
alias("cost_price", "cost price", "cost", "purchase price", "buying price", "unit cost");
alias("selling_price", "selling price", "sell price", "sale price", "price", "retail price");
alias("quantity", "quantity", "qty", "stock", "opening stock", "stock quantity", "on hand", "opening quantity");
alias("min_stock", "min stock", "minimum stock", "reorder level", "reorder point", "min qty", "minimum quantity");
alias("shop_id", "shop id", "salon id", "store id", "branch id", "shop code", "salon code", "fastque shop id");
alias("shop_name", "shop name", "salon name", "store name", "branch name", "shop", "salon", "store");
alias("visibility", "visibility", "scope", "catalog scope", "global or shop");
alias("hsn_code", "hsn", "hsn code", "hsn sac");
alias("gst_rate", "gst", "gst rate", "gst %", "tax rate", "gst rate %");
alias("product_type", "product type", "usage", "professional or retail", "type of use");
alias("image_url", "image url", "image", "photo", "photo url", "image link", "picture");
alias("data_status", "data status", "status", "notes", "remarks", "comment");

/** Best field for one header text, or null when it is not recognised. */
export function guessUploadField(header: string): UploadField | null {
  const k = key(header);
  if (!k) return null;
  if (EXACT[k]) return EXACT[k];
  const has = (...words: string[]) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(k));
  const codeish = has("ean", "ean13", "barcode", "upc", "gtin") || /(^| )bar code( |$)/.test(k);
  if (codeish && has("image", "img", "picture", "photo")) return "barcode_image";
  if (codeish && has("type", "format", "symbology")) return "barcode_type";
  if (codeish) return "barcode";
  if (has("shop", "salon", "store", "branch") && has("id", "code")) return "shop_id";
  if (has("shop", "salon", "store", "branch")) return "shop_name";
  if (has("sku") || (has("product", "item", "article") && has("id", "code", "ref", "no"))) return "product_ref";
  if (has("sub") && has("category")) return "subcategory";
  if (has("category")) return "category";
  if (has("brand")) return "brand";
  if (has("manufacturer", "company")) return "manufacturer";
  if (has("variant", "size", "shade")) return "variant";
  if (has("mrp")) return "mrp";
  if (has("cost", "purchase")) return "cost_price";
  if (has("price", "selling", "sale")) return "selling_price";
  if (has("min", "minimum", "reorder")) return "min_stock";
  if (has("qty", "quantity", "stock")) return "quantity";
  if (has("hsn")) return "hsn_code";
  if (has("gst", "tax")) return "gst_rate";
  if (has("visibility", "scope")) return "visibility";
  if (has("image", "photo", "picture")) return "image_url";
  if (has("unit", "uom")) return "unit";
  if (has("description")) return "description";
  if (has("name", "product", "item", "title")) return "name";
  if (has("status", "notes", "remarks")) return "data_status";
  return null;
}

/** column index → field (null = ignored). Sent back by the admin to override the detection. */
export type UploadColumnMapping = Array<UploadField | null>;

export interface DetectedHeader {
  /** 0-based index of the header row within the sheet's rows. */
  headerRowIndex: number;
  headers: string[];
  mapping: UploadColumnMapping;
  warnings: string[];
}

/**
 * Finds the header row (the first 15 rows are searched; the one recognising the most fields wins,
 * with at least a name or barcode column) and maps each column to a field. A field can only be
 * mapped once; later duplicates are ignored with a warning.
 */
export function detectUploadHeader(rows: string[][], override?: UploadColumnMapping | null): DetectedHeader | null {
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const fields = rows[i].map(guessUploadField).filter((f): f is UploadField => !!f);
    if (!fields.includes("name") && !fields.includes("barcode")) continue;
    const score = new Set(fields).size;
    if (!best || score > best.score) best = { index: i, score };
  }
  if (!best) return null;
  const headers = rows[best.index].map((h) => (h ?? "").trim());
  const warnings: string[] = [];
  const used = new Set<UploadField>();
  const mapping: UploadColumnMapping = headers.map((h, col) => {
    const wanted = override ? override[col] ?? null : guessUploadField(h);
    if (!wanted) {
      if (h && !override) warnings.push(`Column "${h}" is not recognised and will be ignored.`);
      return null;
    }
    if (!(UPLOAD_FIELDS as readonly string[]).includes(wanted)) return null;
    if (used.has(wanted)) {
      warnings.push(`Column "${h}" is ignored: ${UPLOAD_FIELD_LABELS[wanted]} is already read from another column.`);
      return null;
    }
    used.add(wanted);
    return wanted;
  });
  if (!used.has("name")) warnings.push("No product name column was found.");
  if (!used.has("barcode")) warnings.push("No barcode column was found; rows need a product code instead.");
  return { headerRowIndex: best.index, headers, mapping, warnings };
}

// ---------- Rows ----------

export interface UploadIssue {
  severity: UploadIssueSeverity;
  code: string;
  field: UploadField | null;
  message: string;
  rawValue?: string | null;
}

/** One normalized row, as previewed and later committed (stored on the upload job). */
export interface UploadRowCandidate {
  /** 1-based spreadsheet row number, as the admin sees it in Excel. */
  rowNumber: number;
  barcode: { raw: string; code: string; display: string; format: BarcodeFormat; symbology: string } | null;
  productRef: string | null;
  name: string | null;
  brand: string | null;
  manufacturer: string | null;
  category: string | null;
  subcategory: string | null;
  variant: string | null;
  description: string | null;
  packSize: number | null;
  packUnit: InventoryUnit | null;
  unit: InventoryUnit;
  mrp: number | null;
  costPrice: number | null;
  sellingPrice: number | null;
  quantity: number | null;
  minStock: number | null;
  shopId: string | null;
  shopName: string | null;
  visibility: CatalogVisibility | null;
  hsnCode: string | null;
  gstRatePercent: number | null;
  productType: ProductType;
  imageUrl: string | null;
  isTestData: boolean;
  hasEmbeddedBarcodeImage: boolean;
  issues: UploadIssue[];
}

const UNIT_ALIASES: Record<string, InventoryUnit> = {
  each: "EACH", ea: "EACH", pc: "EACH", pcs: "EACH", piece: "EACH", pieces: "EACH", unit: "EACH", units: "EACH", nos: "EACH", no: "EACH", bottle: "EACH", tube: "EACH", jar: "EACH",
  g: "GRAM", gm: "GRAM", gms: "GRAM", gram: "GRAM", grams: "GRAM",
  kg: "KILOGRAM", kgs: "KILOGRAM", kilogram: "KILOGRAM",
  ml: "MILLILITER", milliliter: "MILLILITER", millilitre: "MILLILITER",
  l: "LITER", ltr: "LITER", liter: "LITER", litre: "LITER",
  pack: "PACK", packs: "PACK", pkt: "PACK", packet: "PACK", set: "PACK", kit: "PACK",
  box: "BOX", boxes: "BOX", carton: "BOX",
};

export function parseUnit(text: string | null | undefined): InventoryUnit | null {
  if (!text) return null;
  const k = text.trim().toLowerCase().replace(/\.$/, "");
  if (UNIT_ALIASES[k]) return UNIT_ALIASES[k];
  const upper = k.toUpperCase();
  return upper in InventoryUnit ? (upper as InventoryUnit) : null;
}

/** "100 ml" → { size: 100, unit: MILLILITER }; "1 pack" → { 1, PACK }; "Shade 4" → null. */
export function parseVariantSize(text: string | null | undefined): { size: number; unit: InventoryUnit } | null {
  const m = (text ?? "").trim().match(/^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)\.?$/);
  if (!m) return null;
  const unit = parseUnit(m[2]);
  const size = Number(m[1]);
  return unit && size > 0 && size <= 999999 ? { size, unit } : null;
}

/** Symbology expected for a typed barcode type ("EAN-13", "UPC-A", ...); null = any / unknown. */
function expectedDigits(type: string | null): { label: string; digits: number } | null {
  const t = (type ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t === "EAN13" || t === "JAN13" || t === "GTIN13") return { label: "EAN-13", digits: 13 };
  if (t === "EAN8" || t === "GTIN8") return { label: "EAN-8", digits: 8 };
  if (t === "UPCA" || t === "UPC" || t === "GTIN12") return { label: "UPC-A", digits: 12 };
  if (t === "GTIN14" || t === "ITF14") return { label: "GTIN-14", digits: 14 };
  return null;
}

export function symbologyOf(display: string, format: BarcodeFormat): string {
  if (format !== "GTIN") return "OTHER";
  return ({ 8: "EAN-8", 12: "UPC-A", 13: "EAN-13", 14: "GTIN-14" } as Record<number, string>)[display.length] ?? "GTIN";
}

/** True for EAN/UPC digit strings whose check digit is right (8, 12, 13 or 14 digits). */
export function isValidGtin(digits: string): boolean {
  return /^(\d{8}|\d{12,14})$/.test(digits) && gtinCheckDigit(digits.slice(0, -1)) === Number(digits[digits.length - 1]);
}

const TEST_MARKERS = /\b(fake|test|dummy|sample|demo|synthetic)\b/i;

export interface UploadCell {
  text: string;
  /** The spreadsheet stored the cell as a number (leading zeros may already be gone). */
  numeric?: boolean;
}

/**
 * Validates and normalizes one data row. Errors make the row unusable; warnings are notes. Nothing
 * here touches the database.
 */
export function normalizeUploadRow(
  cells: UploadCell[],
  mapping: UploadColumnMapping,
  rowNumber: number,
  options: { markAsTestData?: boolean; embeddedBarcodeImages?: number } = {},
): UploadRowCandidate {
  const issues: UploadIssue[] = [];
  const err = (field: UploadField | null, code: string, message: string, rawValue?: string | null) =>
    issues.push({ severity: "ERROR", field, code, message, rawValue: rawValue ?? null });
  const warn = (field: UploadField | null, code: string, message: string, rawValue?: string | null) =>
    issues.push({ severity: "WARNING", field, code, message, rawValue: rawValue ?? null });
  const cellOf = (field: UploadField): UploadCell | null => {
    const at = mapping.indexOf(field);
    if (at === -1) return null;
    const cell = cells[at];
    if (!cell) return null;
    const text = cell.text.replace(/ /g, " ").trim();
    return text === "" ? null : { ...cell, text };
  };
  const str = (field: UploadField, max: number) => {
    const cell = cellOf(field);
    if (!cell) return null;
    if (cell.text.length > max) {
      warn(field, "TRUNCATED", `${UPLOAD_FIELD_LABELS[field]} is longer than ${max} characters and was shortened.`, cell.text.slice(0, 120));
      return cell.text.slice(0, max);
    }
    return cell.text;
  };
  const num = (field: UploadField, opts: { min?: number; max?: number; decimals: number }) => {
    const cell = cellOf(field);
    if (!cell) return null;
    const parsed = Number(cell.text.replace(/[₹,\s]|rs\.?|inr/gi, ""));
    if (!Number.isFinite(parsed)) {
      err(field, "NOT_A_NUMBER", `${UPLOAD_FIELD_LABELS[field]} must be a number.`, cell.text);
      return null;
    }
    if (parsed < (opts.min ?? 0) || parsed > (opts.max ?? 9_999_999_999)) {
      err(field, "OUT_OF_RANGE", `${UPLOAD_FIELD_LABELS[field]} is out of range.`, cell.text);
      return null;
    }
    const factor = 10 ** opts.decimals;
    return Math.round(parsed * factor) / factor;
  };

  // Barcode: always text; validate check digits for EAN/UPC; keep leading zeros.
  let barcode: UploadRowCandidate["barcode"] = null;
  const barcodeCell = cellOf("barcode");
  const typeText = str("barcode_type", 30);
  if (barcodeCell) {
    let raw = barcodeCell.text;
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(raw)) {
      err("barcode", "BARCODE_SCIENTIFIC", "The barcode was saved by Excel as a rounded number (e.g. 8.9E+12). Format the column as Text and type the full number.", raw);
      raw = "";
    }
    if (raw) {
      const expected = expectedDigits(typeText);
      const digitsOnly = raw.replace(/[\s-]/g, "");
      if (expected && /^\d+$/.test(digitsOnly) && digitsOnly.length !== expected.digits) {
        if (barcodeCell.numeric && digitsOnly.length < expected.digits)
          err("barcode", "BARCODE_LEADING_ZEROS_LOST", `This ${expected.label} has ${digitsOnly.length} digits; Excel probably dropped leading zeros. Format the column as Text.`, raw);
        else err("barcode", "BARCODE_LENGTH", `${expected.label} barcodes have ${expected.digits} digits; this one has ${digitsOnly.length}.`, raw);
      } else {
        const normalized = normalizeBarcode(raw);
        if (!normalized.ok) err("barcode", "BARCODE_INVALID", normalized.reason, raw);
        else {
          barcode = { raw, code: normalized.code, display: normalized.display, format: normalized.format, symbology: symbologyOf(normalized.display, normalized.format) };
          if (barcodeCell.numeric) warn("barcode", "BARCODE_NUMERIC_CELL", "The barcode was stored as a number in Excel. It was read correctly, but format the column as Text so leading zeros are never lost.", raw);
        }
      }
    }
  }
  const hasEmbeddedBarcodeImage = (options.embeddedBarcodeImages ?? 0) > 0;
  if ((options.embeddedBarcodeImages ?? 0) > 1)
    warn("barcode_image", "BARCODE_IMAGE_AMBIGUOUS", "More than one picture sits on this row; pictures are not imported. The typed barcode number is used.");
  if (!barcodeCell && hasEmbeddedBarcodeImage)
    err("barcode", "BARCODE_ONLY_IMAGE", "This row only has a barcode picture. Type the barcode number in the barcode column (pictures are not read).");

  const productRef = str("product_ref", 80);
  const name = str("name", 160);
  if (!name) err("name", "NAME_REQUIRED", "Product name is required.");
  if (!barcode && !productRef && !issues.some((i) => i.field === "barcode"))
    err("barcode", "IDENTITY_REQUIRED", "Each row needs a barcode or a product code so re-imports find the same product.");
  if (!barcode && productRef && !barcodeCell) warn("barcode", "BARCODE_MISSING", "No barcode — the product can only be found by name or product code.");

  const variant = str("variant", 80);
  let packSize = num("pack_size", { min: 0, max: 999999, decimals: 3 });
  const packUnitText = str("pack_unit", 20);
  let packUnit = parseUnit(packUnitText);
  if (packUnitText && !packUnit) err("pack_unit", "UNKNOWN_UNIT", `Unknown pack unit "${packUnitText}".`, packUnitText);
  if (packSize === null && !packUnit) {
    const fromVariant = parseVariantSize(variant);
    if (fromVariant) {
      packSize = fromVariant.size;
      packUnit = fromVariant.unit;
    }
  }
  const unitText = str("unit", 20);
  const unit = parseUnit(unitText) ?? "EACH";
  if (unitText && !parseUnit(unitText)) warn("unit", "UNKNOWN_UNIT", `Unknown unit "${unitText}"; counted as pieces.`, unitText);

  const visibilityText = str("visibility", 20);
  let visibility: CatalogVisibility | null = null;
  if (visibilityText) {
    const v = visibilityText.toUpperCase();
    if (/^(GLOBAL|ALL|PUBLIC|COMMON|MASTER)$/.test(v)) visibility = "GLOBAL";
    else if (/^(SHOP|SALON|PRIVATE|STORE|LOCAL)$/.test(v)) visibility = "SHOP";
    else err("visibility", "VISIBILITY_INVALID", `Visibility must be "global" or "shop".`, visibilityText);
  }
  const shopId = str("shop_id", 80);
  const shopName = str("shop_name", 160);
  if (visibility === "SHOP" && !shopId && !shopName) err("shop_name", "SHOP_REQUIRED", "Shop-only products need a shop name or shop ID.");

  const typeOfUse = str("product_type", 20);
  let productType: ProductType = ProductType.BOTH;
  if (typeOfUse) {
    const t = typeOfUse.toUpperCase();
    if (t.startsWith("PRO")) productType = ProductType.PROFESSIONAL;
    else if (t.startsWith("RET") || t === "SALE" || t === "RESALE") productType = ProductType.RETAIL;
    else if (t === "BOTH") productType = ProductType.BOTH;
    else warn("product_type", "PRODUCT_TYPE_UNKNOWN", `Product type "${typeOfUse}" is not professional/retail/both; "both" is used.`, typeOfUse);
  }
  const hsnCode = str("hsn_code", 8);
  if (hsnCode && !/^\d{4,8}$/.test(hsnCode)) err("hsn_code", "HSN_INVALID", "HSN codes have 4 to 8 digits.", hsnCode);
  const imageUrl = str("image_url", 500);
  if (imageUrl && !/^https:\/\/\S+$/.test(imageUrl)) err("image_url", "IMAGE_URL_INVALID", "Image URL must start with https://.", imageUrl);

  const dataStatus = str("data_status", 120);
  const isTestData = !!options.markAsTestData || (dataStatus ? TEST_MARKERS.test(dataStatus) : false);
  const quantity = num("quantity", { min: 0, max: 999999999, decimals: 3 });

  return {
    rowNumber,
    barcode,
    productRef,
    name,
    brand: str("brand", 120),
    manufacturer: str("manufacturer", 160),
    category: str("category", 80),
    subcategory: str("subcategory", 80),
    variant,
    description: str("description", 1000),
    packSize: packSize && packSize > 0 ? packSize : null,
    packUnit,
    unit,
    mrp: num("mrp", { decimals: 2 }),
    costPrice: num("cost_price", { decimals: 2 }),
    sellingPrice: num("selling_price", { decimals: 2 }),
    quantity,
    minStock: num("min_stock", { max: 999999999, decimals: 3 }),
    shopId,
    shopName,
    visibility,
    hsnCode: hsnCode && /^\d{4,8}$/.test(hsnCode) ? hsnCode : null,
    gstRatePercent: num("gst_rate", { max: 28, decimals: 2 }),
    productType,
    imageUrl: imageUrl && /^https:\/\/\S+$/.test(imageUrl) ? imageUrl : null,
    isTestData,
    hasEmbeddedBarcodeImage,
    issues,
  };
}

/** Normalized shop name used to match an uploaded shop name to exactly one salon. */
export const normalizeShopName = (value: string) =>
  value.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/** CSV-safe cell for downloads: quotes, and neutralises spreadsheet formulas (= + - @ tab CR). */
export function csvSafeCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const INVENTORY_UPLOAD_TEMPLATE_HEADERS = [
  "Barcode", "Barcode Type", "Product Code", "Product Name", "Brand", "Category", "Subcategory", "Variant / Size", "Unit",
  "MRP", "Cost Price", "Selling Price", "Opening Quantity", "Min Stock", "Shop ID", "Shop Name", "Visibility", "Product Type", "Image URL",
] as const;

// ---------- Schemas ----------

const mappingSchema = z.array(z.enum(UPLOAD_FIELDS).nullable()).max(200);

/** Multipart form fields sent with the upload (file field "file"). */
export const inventoryUploadPreviewSchema = z
  .object({
    /** JSON: the admin's column → field mapping, replacing the automatic detection. */
    mapping: z
      .string()
      .max(10000)
      .optional()
      .transform((value, ctx) => {
        if (!value) return null;
        try {
          return mappingSchema.parse(JSON.parse(value));
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Column mapping is not valid." });
          return z.NEVER;
        }
      }),
    sheetName: z.string().trim().max(120).optional(),
    sourceReference: z.string().trim().max(300).optional(),
    sourceLicense: z.string().trim().max(80).optional(),
    markAsTestData: z
      .enum(["true", "false"])
      .optional()
      .transform((v) => v === "true"),
  })
  .strict();
export type InventoryUploadPreviewInput = z.infer<typeof inventoryUploadPreviewSchema>;

export const inventoryUploadListQuerySchema = z
  .object({
    status: z.nativeEnum(InventoryUploadStatus).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type InventoryUploadListQuery = z.infer<typeof inventoryUploadListQuerySchema>;

export const inventoryUploadIssuesQuerySchema = z
  .object({
    severity: z.nativeEnum(UploadIssueSeverity).optional(),
    phase: z.enum(["PREVIEW", "COMMIT"]).optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type InventoryUploadIssuesQuery = z.infer<typeof inventoryUploadIssuesQuerySchema>;

/** Owner: browse the catalog products this salon can use (GLOBAL + its own SHOP products). */
export const ownerCatalogBrowseQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    category: z.string().trim().max(80).optional(),
    notInInventory: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    cursor: z.string().trim().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type OwnerCatalogBrowseQuery = z.infer<typeof ownerCatalogBrowseQuerySchema>;

const money = z.number().finite().nonnegative().max(9999999999.99).multipleOf(0.01);

/** Owner: add a catalog product to the salon's inventory with zero stock (stock comes in via the ledger). */
export const ownerAddCatalogProductSchema = z
  .object({
    globalProductId: z.string().uuid(),
    usage: z.enum(["PROFESSIONAL", "RETAIL"]).default("PROFESSIONAL"),
    unit: z.nativeEnum(InventoryUnit).optional(),
    sellingPrice: money.optional().nullable(),
    reorderThreshold: z.number().finite().nonnegative().max(999999999.999).multipleOf(0.001).optional(),
  })
  .strict();
export type OwnerAddCatalogProductInput = z.infer<typeof ownerAddCatalogProductSchema>;

export const catalogChangeRequestSchema = z
  .object({
    globalProductId: z.string().uuid().optional().nullable(),
    barcode: z.string().trim().max(64).optional().nullable(),
    message: z.string().trim().min(5).max(1000),
    proposedFields: z
      .object({
        name: z.string().trim().max(160).optional(),
        brand: z.string().trim().max(120).optional(),
        category: z.string().trim().max(80).optional(),
        variant: z.string().trim().max(80).optional(),
        barcode: z.string().trim().max(64).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => !!v.globalProductId || !!v.barcode, { message: "Say which product (or barcode) this is about.", path: ["globalProductId"] });
export type CatalogChangeRequestInput = z.infer<typeof catalogChangeRequestSchema>;

export const catalogChangeRequestListQuerySchema = z
  .object({
    status: z.enum(["OPEN", "RESOLVED", "REJECTED"]).optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type CatalogChangeRequestListQuery = z.infer<typeof catalogChangeRequestListQuerySchema>;

export const resolveCatalogChangeRequestSchema = z
  .object({
    status: z.enum(["RESOLVED", "REJECTED"]),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type ResolveCatalogChangeRequestInput = z.infer<typeof resolveCatalogChangeRequestSchema>;

/** Admin catalog list filters added for the master upload (visibility / shop / missing barcode). */
export const adminMasterListQuerySchema = z
  .object({
    visibility: z.nativeEnum(CatalogVisibility).optional(),
    salonId: z.string().uuid().optional(),
    missingBarcode: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
    testData: z.enum(["true", "false"]).optional(),
  })
  .partial();

// ---------- DTOs ----------

export interface UploadRowPreviewDto {
  rowNumber: number;
  action: UploadRowAction;
  barcode: string | null;
  symbology: string | null;
  productRef: string | null;
  name: string | null;
  brand: string | null;
  category: string | null;
  variant: string | null;
  shop: { id: string; name: string } | null;
  shopText: string | null;
  isTestData: boolean;
  existingProductId: string | null;
  issues: UploadIssue[];
}

export interface InventoryUploadSummaryDto {
  totalRows: number;
  createGlobal: number;
  createShop: number;
  linkShop: number;
  unchanged: number;
  skipped: number;
  review: number;
  errors: number;
  warnings: number;
  globalRows: number;
  shopRows: number;
  embeddedImages: number;
}

export interface InventoryUploadPreviewDto {
  jobId: string;
  fileName: string;
  fileType: "XLSX" | "CSV";
  sheetName: string | null;
  sheets: string[];
  headerRow: number;
  headers: string[];
  mapping: UploadColumnMapping;
  fieldLabels: Record<UploadField, string>;
  fileWarnings: string[];
  summary: InventoryUploadSummaryDto;
  rows: UploadRowPreviewDto[];
  /** Same file (by SHA-256) was imported before — re-importing is safe and only adds what is missing. */
  previousImports: Array<{ jobId: string; completedAt: string | null; status: InventoryUploadStatus }>;
  testDataInProductionBlocked: boolean;
}

export interface InventoryUploadJobDto {
  id: string;
  fileName: string;
  fileType: "XLSX" | "CSV";
  fileSizeBytes: number;
  sheetName: string | null;
  status: InventoryUploadStatus;
  uploadedBy: { id: string; name: string | null; email: string | null };
  sourceReference: string | null;
  sourceLicense: string | null;
  markAsTestData: boolean;
  totalRows: number;
  createdCount: number;
  linkedCount: number;
  unchangedCount: number;
  skippedCount: number;
  errorCount: number;
  warningCount: number;
  reviewCount: number;
  embeddedImageCount: number;
  failureMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface InventoryUploadIssueDto {
  id: string;
  rowNumber: number;
  severity: UploadIssueSeverity;
  code: string;
  field: string | null;
  message: string;
  rawValue: string | null;
  phase: "PREVIEW" | "COMMIT";
}

export interface InventoryMasterStatsDto {
  totalProducts: number;
  globalProducts: number;
  shopProducts: number;
  testDataProducts: number;
  pendingReview: number;
  missingBarcodes: number;
  salonsUsingInventory: number;
  salonsWithShopProducts: number;
  failedUploads: number;
  pendingUploads: number;
  openChangeRequests: number;
  recentImports: InventoryUploadJobDto[];
  categories: Array<{ category: string; products: number }>;
}

export interface OwnerCatalogProductDto {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  subcategory: string | null;
  variant: string | null;
  packSize: string | null;
  packUnit: InventoryUnit | null;
  mrp: string | null;
  visibility: CatalogVisibility;
  isTestData: boolean;
  barcodes: Array<{ code: string; display: string; symbology: string }>;
  imageUrl: string | null;
  /** This salon's own inventory rows for the product (one per shelf), empty when not stocked. */
  inMyInventory: Array<{ inventoryProductId: string; usage: "PROFESSIONAL" | "RETAIL"; stockOnHand: string }>;
}

export interface OwnerInventorySummaryDto {
  activeProducts: number;
  lowStock: number;
  outOfStock: number;
  stockValue: string;
  catalogLinked: number;
  recentTransactions: Array<{
    id: string;
    productId: string;
    productName: string;
    kind: string;
    transactionType: InventoryTransactionType;
    quantityDelta: string;
    stockAfter: string;
    recordedAt: string;
  }>;
  consumption30d: Array<{ productId: string; productName: string; unit: InventoryUnit; quantity: string }>;
}

export interface CatalogChangeRequestDto {
  id: string;
  salon: { id: string; name: string };
  requestedBy: { id: string; name: string | null };
  product: { id: string; name: string; barcode: string | null } | null;
  barcode: string | null;
  message: string;
  proposedFields: Record<string, string> | null;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  resolutionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}
