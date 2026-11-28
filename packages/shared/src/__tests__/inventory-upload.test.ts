import {
  csvSafeCell,
  detectUploadHeader,
  guessUploadField,
  normalizeShopName,
  normalizeUploadRow,
  parseVariantSize,
  transactionTypeOfKind,
  type UploadCell,
} from "../inventory-upload";

const FILE_HEADERS = [
  "Product ID", "Category", "Product Name", "Fictional Brand", "Variant / Size", "Unit",
  "EAN-13 Test Number", "Barcode Image", "Barcode Type", "Data Status",
];
const cells = (values: string[], numeric: number[] = []): UploadCell[] =>
  values.map((text, i) => ({ text, numeric: numeric.includes(i) }));

describe("inventory upload header detection", () => {
  it("maps the FastQue sample sheet's headers", () => {
    const detected = detectUploadHeader([FILE_HEADERS]);
    expect(detected?.headerRowIndex).toBe(0);
    expect(detected?.mapping).toEqual([
      "product_ref", "category", "name", "brand", "variant", "unit", "barcode", "barcode_image", "barcode_type", "data_status",
    ]);
    expect(detected?.warnings).toEqual([]);
  });

  it.each([
    ["EAN", "barcode"], ["Barcode Number", "barcode"], ["UPC Code", "barcode"], ["GTIN", "barcode"],
    ["Salon Name", "shop_name"], ["Shop Name", "shop_name"], ["Store", "shop_name"], ["Shop ID", "shop_id"],
    ["SKU", "product_ref"], ["Item Name", "name"], ["Reorder Level", "min_stock"], ["Qty", "quantity"],
    ["Sub Category", "subcategory"], ["Selling Price (₹)", "selling_price"], ["Cost", "cost_price"],
  ])("recognises %s", (header, field) => {
    expect(guessUploadField(header)).toBe(field);
  });

  it("finds a header row below a title and ignores repeated fields", () => {
    const detected = detectUploadHeader([["FastQue stock list"], [], ["Barcode", "Name", "EAN", "Shop"]]);
    expect(detected?.headerRowIndex).toBe(2);
    expect(detected?.mapping).toEqual(["barcode", "name", null, "shop_name"]);
    expect(detected?.warnings.join(" ")).toMatch(/EAN/);
  });

  it("returns null when no name or barcode column exists", () => {
    expect(detectUploadHeader([["foo", "bar"]])).toBeNull();
  });
});

describe("inventory upload row normalization", () => {
  const mapping = detectUploadHeader([FILE_HEADERS])!.mapping;

  it("normalizes a sample row: text barcode, variant size, test-data flag", () => {
    const row = normalizeUploadRow(
      cells(["FQ-TST-001", "Hair Care", "Daily Shampoo", "Studio Sample", "100 ml", "unit", "2000000000015", "", "EAN-13", "FAKE / TEST ONLY"]),
      mapping,
      2,
      { embeddedBarcodeImages: 1 },
    );
    expect(row.issues).toEqual([]);
    expect(row.barcode).toEqual({ raw: "2000000000015", code: "02000000000015", display: "2000000000015", format: "GTIN", symbology: "EAN-13" });
    expect(row).toMatchObject({ productRef: "FQ-TST-001", name: "Daily Shampoo", packSize: 100, packUnit: "MILLILITER", unit: "EACH", isTestData: true, hasEmbeddedBarcodeImage: true });
  });

  it("rejects a bad EAN-13 check digit and a wrong length", () => {
    const bad = normalizeUploadRow(cells(["X1", "", "A", "", "", "", "2000000000016", "", "EAN-13", ""]), mapping, 3);
    expect(bad.barcode).toBeNull();
    expect(bad.issues.map((i) => i.code)).toContain("BARCODE_INVALID");
    const short = normalizeUploadRow(cells(["X2", "", "A", "", "", "", "12345678905", "", "EAN-13", ""], [6]), mapping, 4);
    expect(short.issues.map((i) => i.code)).toContain("BARCODE_LEADING_ZEROS_LOST");
  });

  it("keeps leading zeros and flags numbers Excel rounded", () => {
    const zero = normalizeUploadRow(cells(["", "", "A", "", "", "", "0012345678905", "", "EAN-13", ""]), mapping, 5);
    expect(zero.barcode?.display).toBe("0012345678905");
    const sci = normalizeUploadRow(cells(["", "", "A", "", "", "", "8.90123E+12", "", "", ""], [6]), mapping, 6);
    expect(sci.issues.map((i) => i.code)).toContain("BARCODE_SCIENTIFIC");
  });

  it("needs a name and some identity; a picture alone is not a barcode", () => {
    const row = normalizeUploadRow(cells(["", "", "", "", "", "", "", "", "", ""]), mapping, 7, { embeddedBarcodeImages: 1 });
    expect(row.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["NAME_REQUIRED", "BARCODE_ONLY_IMAGE"]));
  });

  it("requires a shop for shop-only rows", () => {
    const m = detectUploadHeader([["Barcode", "Name", "Visibility"]])!.mapping;
    const row = normalizeUploadRow(cells(["2000000000015", "A", "shop"]), m, 2);
    expect(row.issues.map((i) => i.code)).toContain("SHOP_REQUIRED");
  });
});

describe("helpers", () => {
  it("parses sizes", () => {
    expect(parseVariantSize("250 g")).toEqual({ size: 250, unit: "GRAM" });
    expect(parseVariantSize("1 pack")).toEqual({ size: 1, unit: "PACK" });
    expect(parseVariantSize("Shade 4")).toBeNull();
  });
  it("neutralises formulas in CSV cells", () => {
    expect(csvSafeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvSafeCell("-5")).toBe("'-5");
    expect(csvSafeCell('a,"b"')).toBe('"a,""b"""');
  });
  it("normalizes shop names and maps ledger kinds", () => {
    expect(normalizeShopName("  Ayushi  Shop & Spa ")).toBe("ayushi shop and spa");
    expect(transactionTypeOfKind("PURCHASE")).toBe("STOCK_IN");
    expect(transactionTypeOfKind("CONSUMPTION")).toBe("SERVICE_CONSUMPTION");
    expect(transactionTypeOfKind("WASTAGE")).toBe("STOCK_OUT");
  });
});
