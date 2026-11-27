import { zipSync, strToU8 } from "fflate";
import { parseDelimited, parseXlsx, tableToServices, SERVICE_SHEET_TEMPLATE_CSV } from "../service-sheet-import";

function xlsx(sheetXml: string, sharedStrings: string[], level: 0 | 6 = 0) {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Services" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/sharedStrings.xml": strToU8("<sst>" + sharedStrings.map((s: string) => "<si><t>" + s + "</t></si>").join("") + "</sst>"),
    "xl/worksheets/sheet1.xml": strToU8("<worksheet><sheetData>" + sheetXml + "</sheetData></worksheet>"),
  }, { level });
}

describe("service sheet import", () => {
  test("template CSV round-trips into three services", () => {
    const { rows, notes } = tableToServices(parseDelimited(SERVICE_SHEET_TEMPLATE_CSV));
    expect(notes).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ serviceName: "Haircut", category: "Hair", applicableGender: "MEN", basePrice: 200, priceType: "FIXED", durationMinutes: 30, uncertainFields: [] });
    expect(rows[1]).toMatchObject({ applicableGender: "WOMEN", priceType: "STARTS_FROM", discountedPrice: 1200, durationMinutes: 90 });
  });

  test("loose headers, rupee prices, hour durations and missing fields are flagged", () => {
    const table = parseDelimited('Item;Rate (Rs);Time\n"Facial, gold";₹1,499;1 hr 30 min\nThreading;50;\n;;\n');
    const { rows, notes } = tableToServices(table);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ serviceName: "Facial, gold", basePrice: 1499, durationMinutes: 90, uncertainFields: [] });
    expect(rows[1].uncertainFields).toContain("durationMinutes");
    expect(notes.join(" ")).toMatch(/1 service\(s\) have no readable duration/);
  });

  test("discount above price is dropped and flagged", () => {
    const { rows } = tableToServices([["Service", "Price", "Offer price", "Duration"], ["Spa", "500", "800", "45"]]);
    expect(rows[0].discountedPrice).toBeNull();
    expect(rows[0].uncertainFields).toContain("discountedPrice");
  });

  test("no service column gives a clear note", () => {
    expect(tableToServices([["Foo", "Bar"], ["a", "b"]]).notes[0]).toMatch(/Service name/);
  });

  test("reads the first worksheet of an .xlsx (shared and inline strings, numbers, gaps)", async () => {
    const sheet =
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>250</v></c><c r="D2"><v>40</v></c></row>' +
      '<row r="3"><c r="A3" t="inlineStr"><is><t>Head &amp; shoulder massage</t></is></c><c r="B3"><v>300</v></c></row>';
    const table = await parseXlsx(xlsx(sheet, ["Service name", "Price", "Duration (min)", "Haircut"]));
    expect(table[0]).toEqual(["Service name", "Price", "", "Duration (min)"]);
    const { rows } = tableToServices(table);
    expect(rows.map((r) => [r.serviceName, r.basePrice, r.durationMinutes])).toEqual([
      ["Haircut", 250, 40],
      ["Head & shoulder massage", 300, null],
    ]);
  });

  test("reads an .xlsx whose elements carry a namespace prefix (x:row, x:c)", async () => {
    const files = zipSync({
      "xl/workbook.xml": strToU8('<x:workbook xmlns:x="m"><x:sheets><x:sheet name="S" sheetId="1" r:id="R9" xmlns:r="r"/></x:sheets></x:workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Type="ws" Target="/xl/worksheets/sheet1.xml" Id="R9"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<x:worksheet xmlns:x="m"><x:sheetData>' +
        '<x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>Service</x:t></x:is></x:c><x:c r="B1" t="str"><x:v>Price</x:v></x:c></x:row>' +
        '<x:row r="2"><x:c r="A2" t="inlineStr"><x:is><x:t>Waxing</x:t></x:is></x:c><x:c r="B2"><x:v>400</x:v></x:c></x:row>' +
        "</x:sheetData></x:worksheet>"),
    }, { level: 0 });
    expect(await parseXlsx(files)).toEqual([["Service", "Price"], ["Waxing", "400"]]);
  });

  const inflateTest = test;
  inflateTest("reads a deflate-compressed .xlsx", async () => {
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c></row>';
    const table = await parseXlsx(xlsx(sheet, ["Service", "Pedicure"], 6));
    expect(table).toEqual([["Service"], ["Pedicure"]]);
  });
});

describe("mobile file reading", () => {
  const { base64ToBytes, readServiceSheet } = jest.requireActual("../service-sheet-import");
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

  test("base64 decodes like Buffer", () => {
    const bytes = strToU8("Service,Price\r\nCut ₹,100\r\n");
    expect(Array.from(base64ToBytes(b64(bytes)))).toEqual(Array.from(bytes));
  });

  test("reads a picked .xlsx and a picked .csv", async () => {
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>250</v></c><c r="C2"><v>40</v></c></row>';
    const x = xlsx(sheet, ["Service", "Price", "Duration", "Haircut"], 6);
    const fromX = await readServiceSheet({ name: "Menu.XLSX", size: x.length, readBase64: async () => b64(x) });
    expect(fromX.rows[0]).toMatchObject({ serviceName: "Haircut", basePrice: 250, durationMinutes: 40 });
    const csv = strToU8(SERVICE_SHEET_TEMPLATE_CSV);
    const fromC = await readServiceSheet({ name: "t.csv", size: csv.length, readBase64: async () => b64(csv) });
    expect(fromC.rows).toHaveLength(3);
  });

  test("rejects .xls and unknown types", async () => {
    await expect(readServiceSheet({ name: "a.xls", readBase64: async () => "" })).rejects.toThrow(/xls/);
    await expect(readServiceSheet({ name: "a.pdf", readBase64: async () => "" })).rejects.toThrow(/Excel/);
  });
});
