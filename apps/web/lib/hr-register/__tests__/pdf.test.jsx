import { generateOfferPdf, offerLetterData, pdfFileName, sha256Hex } from "../pdf";
import { createFakeRegister } from "./fake-register";

const TERMS = {
  role: "Field Sales Executive",
  baseSalaryInr: 24000,
  salaryBasis: "monthly",
  salesTarget: null,
  incentiveBeyondTargetInr: null,
  proposedJoiningDate: "2026-11-02",
  reportingManagerId: "m-1",
  city: "Patna",
};

const drawn = (bytes) =>
  [...new TextDecoder().decode(bytes).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1")).join(" ");

async function savedOffer() {
  const api = createFakeRegister();
  const person = api.seedPerson({ fullName: "Asha Kumar", email: "asha@example.test", phone: "9000000001" });
  const offer = api.seedOffer(person, TERMS);
  const contacts = await api.getLetterData(offer.id);
  return { api, person, offer, contacts };
}

describe("offer PDFs come from a saved version", () => {
  test("the letter data is exactly the saved terms, code and issue instant", async () => {
    const { person, offer, contacts } = await savedOffer();
    const data = offerLetterData(person.employeeCode, person.fullName, offer, contacts);
    expect(data).toMatchObject({
      candidateName: "Asha Kumar",
      employeeCode: person.employeeCode,
      issuedAt: offer.issuedAt,
      baseSalary: 24000,
      salaryBasis: "monthly",
      joiningDate: "2026-11-02",
      role: "Field Sales Executive",
    });
    expect(data.salesTarget).toBeUndefined();
    expect(data.incentiveBeyondTarget).toBeUndefined();
  });

  test("file names carry the permanent code and the version", () => {
    expect(pdfFileName("FQ-FE-00123", 3)).toBe("FQ-FE-00123-v3".replace(/^/, "FastQue-Offer-") + ".pdf");
  });

  test("SHA-256 matches a known vector", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("generation hands the PDF over once, then records its exact fingerprint", async () => {
    const { api, person, offer, contacts } = await savedOffer();
    const delivered = [];
    const outcome = await generateOfferPdf({
      api,
      employeeCode: person.employeeCode,
      candidateName: person.fullName,
      offer,
      contacts,
      event: "GENERATED",
      deliver: (bytes, name) => delivered.push({ bytes, name }),
    });
    expect(delivered).toHaveLength(1);
    expect(new TextDecoder().decode(delivered[0].bytes.slice(0, 8))).toBe("%PDF-1.4");
    expect(drawn(delivered[0].bytes)).toContain(`Employee No: ${person.employeeCode}`);
    expect(outcome.recorded).toBe(true);
    expect(outcome.sha256).toBe(await sha256Hex(delivered[0].bytes));
    expect(offer.pdfHistory).toHaveLength(1);
    expect(offer.pdfHistory[0]).toMatchObject({ event: "GENERATED", sha256: outcome.sha256, byteLength: delivered[0].bytes.byteLength });
  });

  test("a reprint of the same saved version reproduces the original PDF byte for byte", async () => {
    const { api, person, offer, contacts } = await savedOffer();
    const run = (event) =>
      generateOfferPdf({ api, employeeCode: person.employeeCode, candidateName: person.fullName, offer, contacts, event, deliver: () => {} });
    const first = await run("GENERATED");
    const second = await run("REPRINTED");
    expect(second.sha256).toBe(first.sha256);
    expect(offer.pdfHistory.map((entry) => entry.event)).toEqual(["GENERATED", "REPRINTED"]);
  });

  test("the standard INR 5,000 Expected Performance Incentive is in every register letter", async () => {
    const { api, person, offer, contacts } = await savedOffer();
    const delivered = [];
    await generateOfferPdf({ api, employeeCode: person.employeeCode, candidateName: person.fullName, offer, contacts, event: "GENERATED", deliver: (bytes) => delivered.push(bytes) });
    expect(drawn(delivered[0])).toContain("INR 5,000 per month");
  });

  test("if the history call fails the PDF still exists and the caller is told it was not recorded", async () => {
    const { api, person, offer, contacts } = await savedOffer();
    api.recordPdfEvent = async () => {
      throw new Error("503");
    };
    const delivered = [];
    const outcome = await generateOfferPdf({ api, employeeCode: person.employeeCode, candidateName: person.fullName, offer, contacts, event: "GENERATED", deliver: (bytes) => delivered.push(bytes) });
    expect(delivered).toHaveLength(1);
    expect(outcome.recorded).toBe(false);
    expect(outcome.event).toBeNull();
    expect(outcome.idempotencyKey).toBeTruthy();
  });

  test("a fake or missing code is refused before any PDF is produced", async () => {
    const { api, offer, contacts } = await savedOffer();
    const delivered = [];
    await expect(
      generateOfferPdf({ api, employeeCode: "TEMP-1", candidateName: "Asha Kumar", offer, contacts, event: "GENERATED", deliver: (bytes) => delivered.push(bytes) }),
    ).rejects.toThrow("permanent FastQue employee ID");
    expect(delivered).toHaveLength(0);
  });
});
