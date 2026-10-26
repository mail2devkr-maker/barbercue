import { ACCEPTED_EXTENSIONS, MAX_FILE_BYTES, contactFileToList, hasAcceptedExtension, plainPhone } from "../contact-file";
import { MAX_CONTACTS, parseContactList } from "../contact-preview";

const lines = (r) => (r.text ? r.text.split("\n") : []);

describe("plainPhone (owner issue #14)", () => {
  it("accepts ordinary phone formats and nothing else", () => {
    for (const ok of ["9876543210", "+91 98765 43210", "(022) 2345-6789", "098765.43210", "+1 (415) 555-0100"]) expect(plainPhone(ok)).toBe(ok);
    for (const bad of ["", "   ", "12345", "call me", "9876543210 ext 5", "=HYPERLINK(\"http://x\")", "+91-98765-4321O", "@cmd", "-1234567890", "9876543210‮", "x".repeat(60)]) {
      expect(plainPhone(bad)).toBeNull();
    }
  });
});

describe("contact files: CSV and plain lists", () => {
  it("reads the phone column named in the header, whatever its position, ignoring names and other columns", () => {
    const r = contactFileToList("Name,Email,Mobile Number\nAsha K,a@x.test,98765 43210\nRavi,r@x.test,+91 91234 56789\n", "contacts.csv");
    expect(r.format).toBe("csv");
    expect(lines(r)).toEqual(["98765 43210", "+91 91234 56789"]);
    expect(r.found).toBe(2);
    expect(r.problems).toEqual([]);
    expect(r.text).not.toMatch(/Asha|a@x\.test/);
  });

  it("understands quoted cells with commas and doubled quotes, a byte-order mark and Windows line endings", () => {
    const csv = "﻿\"Full name\",\"Phone\"\r\n\"Kapoor, Asha \"\"Ash\"\"\",\"98765 43210\"\r\n";
    const r = contactFileToList(csv, "export.csv");
    expect(lines(r)).toEqual(["98765 43210"]);
  });

  it("detects semicolon and tab separated exports", () => {
    expect(lines(contactFileToList("Name;Phone\nAsha;9876543210\n", "a.csv"))).toEqual(["9876543210"]);
    expect(lines(contactFileToList("Name\tMobile\nAsha\t9876543210\n", "a.csv"))).toEqual(["9876543210"]);
  });

  it("accepts header spellings such as phone_number and WhatsApp", () => {
    expect(lines(contactFileToList("name,phone_number\nA,9876543210", "a.csv"))).toEqual(["9876543210"]);
    expect(lines(contactFileToList("name,WhatsApp\nA,9876543210", "a.csv"))).toEqual(["9876543210"]);
  });

  it("reads a single-column file with no header as a plain list", () => {
    const r = contactFileToList("9876543210\n9123456789\n\n", "list.txt");
    expect(r.format).toBe("text");
    expect(lines(r)).toEqual(["9876543210", "9123456789"]);
  });

  it("reads a headerless file whose first column is a phone number, using only that column", () => {
    expect(lines(contactFileToList("9876543210,Asha\n9123456789,Ravi\n", "a.csv"))).toEqual(["9876543210", "9123456789"]);
  });

  it("does NOT guess: several columns, no phone header and a non-phone first column is refused", () => {
    const r = contactFileToList("Asha,Kapoor,Delhi\nRavi,Shah,Pune\n", "a.csv");
    expect(r.found).toBe(0);
    expect(r.problems[0].message).toMatch(/Could not tell which column/);
  });

  it("leaves out anything that is not a plain phone number, including spreadsheet formulas, and says which line", () => {
    const r = contactFileToList("Name,Phone\nA,9876543210\nB,=HYPERLINK(\"http://evil.test\")\nC,+cmd|' /C calc'!A0\nD,\nE,not a number\nF,9123456789\n", "a.csv");
    expect(lines(r)).toEqual(["9876543210", "9123456789"]);
    expect(r.problems.map((p) => p.where)).toEqual(["Line 3", "Line 4", "Line 5", "Line 6"]);
    expect(r.problems.find((p) => p.where === "Line 5").message).toMatch(/No phone number/);
    expect(r.text).not.toMatch(/HYPERLINK|evil|calc/);
  });

  it("an empty file or a file of blank lines yields nothing, without an error", () => {
    expect(contactFileToList("", "a.csv")).toMatchObject({ found: 0, text: "" });
    expect(contactFileToList("\n\n  \n", "a.txt")).toMatchObject({ found: 0, text: "" });
  });

  it("keeps repeated numbers: the server check is what reports repeats, and the file layer must not silently change the list", () => {
    expect(lines(contactFileToList("Phone\n9876543210\n98765 43210\n9876543210\n", "a.csv"))).toHaveLength(3);
  });

  it("stops at the server's limit and says so", () => {
    const many = ["Phone", ...Array.from({ length: MAX_CONTACTS + 20 }, (_, i) => String(9000000000 + i))].join("\n");
    const r = contactFileToList(many, "big.csv");
    expect(r.found).toBe(MAX_CONTACTS);
    expect(r.problems.at(-1).message).toContain(`Only the first ${MAX_CONTACTS}`);
  });

  it("its output is accepted unchanged by the existing list parser, with no problems", () => {
    const r = contactFileToList("Name,Phone\nA,98765 43210\nB,+91 91234 56789\n", "a.csv");
    const parsed = parseContactList(r.text);
    expect(parsed.problems).toEqual([]);
    expect(parsed.rows.map((x) => x.phone)).toEqual(["98765 43210", "+91 91234 56789"]);
  });
});

describe("contact files: vCard exports from a phone", () => {
  const card = (body) => `BEGIN:VCARD\r\nVERSION:3.0\r\n${body}\r\nEND:VCARD\r\n`;

  it("reads the first TEL of each card in vCard 2.1 and 3.0 styles", () => {
    const vcf = card("FN:Asha\r\nTEL;TYPE=CELL:+91 98765 43210") + card("FN:Ravi\r\nTEL;CELL;VOICE:9123456789") + card("FN:Mo\r\nTEL:tel:+919000000001");
    const r = contactFileToList(vcf, "contacts.vcf");
    expect(r.format).toBe("vcard");
    expect(lines(r)).toEqual(["+91 98765 43210", "9123456789", "+919000000001"]);
    expect(r.text).not.toMatch(/Asha|Ravi/);
  });

  it("joins folded lines: a continuation line starts with one space or tab, which is removed", () => {
    expect(lines(contactFileToList(card("FN:Asha\r\nTEL;TYPE=CELL:+91 98765\r\n 43210"), "c.vcf"))).toEqual(["+91 9876543210"]);
    expect(lines(contactFileToList(card("FN:Asha\r\nTEL:+91 98765\r\n\t43210"), "c.vcf"))).toEqual(["+91 9876543210"]);
  });

  it("reports cards with no number, an unusable number, or several numbers - without inventing any", () => {
    const vcf = card("FN:NoPhone\r\nEMAIL:a@x.test") + card("FN:Odd\r\nTEL:call reception") + card("FN:Two\r\nTEL;TYPE=HOME:9111111111\r\nTEL;TYPE=CELL:9222222222");
    const r = contactFileToList(vcf, "c.vcf");
    expect(lines(r)).toEqual(["9111111111"]);
    expect(r.problems.map((p) => p.where + ": " + p.message)).toEqual([
      "Contact 1: No phone number.",
      "Contact 2: Its phone number is not a plain number.",
      "Contact 3: Has more than one number; only the first was used.",
    ]);
  });

  it("is recognised by its content even when the file has another extension", () => {
    expect(contactFileToList(card("TEL:9876543210"), "contacts.txt").format).toBe("vcard");
  });
});

describe("file gatekeeping", () => {
  it("accepts only contact-like extensions, case-insensitively", () => {
    for (const ok of ["a.csv", "A.CSV", "x.txt", "c.vcf", "c.vcard"]) expect(hasAcceptedExtension(ok)).toBe(true);
    for (const bad of ["a.xlsx", "a.exe", "a.csv.exe", "photo.png", "noextension", "a.html"]) expect(hasAcceptedExtension(bad)).toBe(false);
    expect(ACCEPTED_EXTENSIONS).toEqual([".csv", ".txt", ".vcf", ".vcard"]);
  });

  it("caps the file size well below anything that could hurt the page", () => {
    expect(MAX_FILE_BYTES).toBe(512 * 1024);
  });
});
