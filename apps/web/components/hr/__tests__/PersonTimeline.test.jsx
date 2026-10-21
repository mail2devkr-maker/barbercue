import PersonTimeline from "../PersonTimeline";
import { ApiError } from "../../../lib/api";
import { generateOfferPdf, sha256Hex } from "../../../lib/hr-register/pdf";
import { createFakeRegister } from "../../../lib/hr-register/__tests__/fake-register";
import { click, hasButton, mount, setChecked, setValue, submit, text } from "../../../lib/hr-register/__tests__/helpers";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));

const failWithApiError = (status, code, message) => {
  throw new ApiError(status, { error: { code, message } });
};

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

let n = 0;
const key = () => `k-${++n}`;

function setup(options = {}) {
  const api = createFakeRegister({ fail: failWithApiError, ...options });
  const delivered = [];
  return { api, delivered, deliverPdf: (bytes, filename) => delivered.push({ bytes, filename }) };
}

function issued(api, name = "Ravi Verma") {
  const person = api.seedPerson({ fullName: name, email: "ravi@example.test", phone: "9000000002" });
  const offer = api.seedOffer(person, TERMS);
  return { person, offer };
}

async function accepted(api) {
  const made = issued(api);
  await api.transitionOffer(made.offer.id, "ACCEPTED", null, key());
  return made;
}

async function joinedEmployee(api) {
  const made = await accepted(api);
  await api.recordJoining(made.offer.id, { joinedOn: "2026-11-02", temporaryPassword: "temporary-pass" }, key());
  return made;
}

async function show(api, personId, props = {}) {
  return mount(<PersonTimeline api={api} personId={personId} {...props} />);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("PersonTimeline — what HR sees", () => {
  test("permanent code, stage, masked contacts and the offer axis are shown separately from employment", async () => {
    const { api } = setup();
    const { person } = await accepted(api);
    const r = await show(api, person.id);
    const t = text(r);
    expect(t).toContain(person.employeeCode);
    expect(t).toMatch(/permanent ID, never reissued/);
    expect(t).toMatch(/Offered/);
    expect(t).toMatch(/Version 1 · First offer/);
    expect(t).toMatch(/Accepted/);
    expect(t).toMatch(/Not created — offer stage only/);
    expect(t).not.toContain("ravi@example.test");
    expect(t).not.toContain("9000000002");
    expect(t).toMatch(/r•+@example\.test/);
  });

  test("an offer that was emailed is not shown as accepted or joined", async () => {
    const { api } = setup();
    const { person, offer } = issued(api);
    await api.transitionOffer(offer.id, "SENT", null, key());
    const r = await show(api, person.id);
    const t = text(r);
    expect(t).toMatch(/Emailed \(recorded\)/);
    expect(t).toMatch(/No acceptance on record/);
    expect(t).toMatch(/Not created — offer stage only/);
    expect(hasButton(r, /Record joining/)).toBe(false);
  });

  test("an unknown person fails visibly", async () => {
    const { api } = setup();
    const r = await show(api, "p-missing");
    expect(text(r)).toMatch(/Could not load this employee record|not available/);
  });
});

describe("PersonTimeline — offer status changes", () => {
  test("recording an email needs no reason and calls the register once", async () => {
    const { api } = setup();
    const { person, offer } = issued(api);
    const changed = jest.fn();
    const r = await show(api, person.id, { onChanged: changed });
    await click(r, /^Record as emailed/);
    expect(text(r)).toMatch(/FastQue does not send the email/);
    await submit(r, "Record as emailed");
    expect(offer.status).toBe("SENT");
    expect(text(r)).toMatch(/Status recorded/);
    expect(changed).toHaveBeenCalled();
  });

  test("decline and expiry require a written reason", async () => {
    const { api } = setup();
    const { person, offer } = issued(api);
    const r = await show(api, person.id);
    await click(r, /^Record decline/);
    await submit(r, "Record decline");
    expect(text(r)).toMatch(/reason of at least 5 characters/);
    expect(offer.status).toBe("ISSUED");
    await setValue(r, /Reason/, "Took another job");
    await submit(r, "Record decline");
    expect(offer.status).toBe("DECLINED");
    expect(offer.statusReason).toBe("Took another job");
    expect(hasButton(r, /^Record acceptance/)).toBe(false);
  });
});

describe("PersonTimeline — never joined, then re-offered with the same ID", () => {
  test("did-not-join keeps the code, creates no account, and opens the way to a re-offer", async () => {
    const { api } = setup();
    const { person } = await accepted(api);
    const onStartOffer = jest.fn();
    const r = await show(api, person.id, { onStartOffer });
    await click(r, /Record did not join/);
    await submit(r, "Record not joined");
    expect(text(r)).toMatch(/reason of at least 5 characters/);
    await setValue(r, /Reason/, "Did not report on joining day");
    await submit(r, "Record not joined");

    expect(text(r)).toMatch(/Recorded as did not join/);
    expect(text(r)).toMatch(/Not joined/);
    expect(text(r)).toMatch(/Not created — offer stage only/);
    const stored = api.people.get(person.id);
    expect(stored.employeeProfileId).toBeNull();
    expect(stored.employeeCode).toBe(person.employeeCode);

    await click(r, /Issue a new offer \(same ID\)/);
    expect(onStartOffer).toHaveBeenCalledTimes(1);
    expect(onStartOffer.mock.calls[0][0]).toMatchObject({ id: person.id, employeeCode: person.employeeCode });
  });
});

describe("PersonTimeline — joining, exit and rehire", () => {
  test("joining needs matching passwords and an explicit approval; it is the only step that creates the account", async () => {
    const { api } = setup();
    const { person } = await accepted(api);
    const r = await show(api, person.id);
    expect(api.people.get(person.id).employeeProfileId).toBeNull();

    await click(r, /^Record joining/);
    await setValue(r, /Temporary password/, "short");
    await submit(r, "Record joining");
    expect(text(r)).toMatch(/8 to 72 characters/);

    await setValue(r, /Temporary password/, "long-enough-pw");
    await setValue(r, /Confirm password/, "different-pw-1");
    await submit(r, "Record joining");
    expect(text(r)).toMatch(/passwords do not match/);

    await setValue(r, /Confirm password/, "long-enough-pw");
    await submit(r, "Record joining");
    expect(text(r)).toMatch(/Confirm the joining approval/);
    expect(api.calls).not.toContain("recordJoining");

    await setChecked(r, /I approve joining/);
    await submit(r, "Record joining");
    expect(api.calls).toContain("recordJoining");
    expect(text(r)).toMatch(/Joining recorded/);
    expect(text(r)).toMatch(/Exists \(kept across rehires\)/);
    expect(text(r)).toMatch(/Joined/);
    expect(api.people.get(person.id).employeeProfileId).toBeTruthy();
    expect(text(r)).not.toContain("long-enough-pw");
  });

  test("history is kept: salary and reporting-manager entries appear once someone has joined", async () => {
    const { api } = setup();
    const { person } = await joinedEmployee(api);
    const r = await show(api, person.id);
    const t = text(r);
    expect(t).toMatch(/INR 24,000 per month/);
    expect(t).toMatch(/offer v1/);
    expect(t).toMatch(/Synthetic Manager One/);
    expect(t).toMatch(/→ present/);
  });

  test("exit suspends access, keeps the code, and a rehire reuses the account and the code", async () => {
    const { api, deliverPdf } = setup();
    const { person } = await joinedEmployee(api);
    const profileBefore = api.people.get(person.id).employeeProfileId;
    const onStartOffer = jest.fn();
    const r = await show(api, person.id, { onStartOffer, deliverPdf });

    await click(r, /^Record exit/);
    await setValue(r, /Reason/, "Resigned");
    await submit(r, "Record exit");
    expect(api.calls).not.toContain("recordExit");
    await setValue(r, /Reason/, "Resigned for relocation");
    await submit(r, "Record exit");
    expect(text(r)).toMatch(/Confirm the exit/);
    await setChecked(r, /I confirm this employee has left/);
    await submit(r, "Record exit");
    expect(text(r)).toMatch(/Exit recorded/);
    expect(text(r)).toMatch(/Exited/);
    expect(hasButton(r, /^Record exit/)).toBe(false);

    // A year later: rehire offer, acceptance, rejoining — same person, same code, same account.
    await click(r, /Issue a rehire offer/);
    expect(onStartOffer.mock.calls[0][0].employeeCode).toBe(person.employeeCode);
    const summary = (await api.search({ q: "", employeeCode: person.employeeCode, lifecycle: "ALL", offerStatus: "ALL", city: "", managerId: "", issuedFrom: "", issuedTo: "" }, null)).items[0];
    const token = (await api.matchIdentity({ employeeCode: person.employeeCode })).decisionToken;
    const rehire = await api.createOffer({ identity: { mode: "EXISTING", personId: summary.id, decisionToken: token }, terms: { ...TERMS, baseSalaryInr: 30000, proposedJoiningDate: "2027-10-01" } }, key());
    expect(rehire.offer.kind).toBe("REHIRE");
    expect(rehire.person.employeeCode).toBe(person.employeeCode);
    await api.transitionOffer(rehire.offer.id, "ACCEPTED", null, key());

    const r2 = await show(api, person.id);
    expect(text(r2)).toMatch(/Re-offered/);
    await click(r2, /^Record rejoining/);
    expect(text(r2)).toMatch(/No second profile or employee ID is created/);
    await setValue(r2, /Temporary password/, "new-temporary-pw");
    await setValue(r2, /Confirm password/, "new-temporary-pw");
    await setChecked(r2, /I approve joining/);
    await submit(r2, "Record joining");

    expect(text(r2)).toMatch(/Rejoining recorded/);
    expect(text(r2)).toMatch(/Rejoined/);
    expect(api.people.size).toBe(1);
    expect(api.people.get(person.id).employeeProfileId).toBe(profileBefore);
    expect(api.usedCodes.has("FQ-FE-00102")).toBe(false);
    const t = text(r2);
    expect(t).toMatch(/Episode 2/);
    expect(t).toMatch(/Episode 1/);
    expect(t).toMatch(/not shown as continuous/);
    expect(t).toMatch(/INR 30,000 per month/);
    expect(t).toMatch(/INR 24,000 per month/);
  });
});

describe("PersonTimeline — PDF history and reprint", () => {
  test("reprinting a version reproduces the original PDF and appends to the history", async () => {
    const { api, delivered, deliverPdf } = setup();
    const { person, offer } = issued(api);
    const contacts = await api.getLetterData(offer.id);
    const first = await generateOfferPdf({ api, employeeCode: person.employeeCode, candidateName: person.fullName, offer, contacts, event: "GENERATED", deliver: () => {} });

    const r = await show(api, person.id, { deliverPdf });
    expect(text(r)).toMatch(/PDF history \(1\)/);
    expect(text(r)).toContain(first.sha256.slice(0, 12));
    await click(r, /Download version 1 PDF/);

    expect(delivered).toHaveLength(1);
    expect(delivered[0].filename).toBe(`FastQue-Offer-${person.employeeCode}-v1.pdf`);
    expect(await sha256Hex(delivered[0].bytes)).toBe(first.sha256);
    expect(offer.pdfHistory.map((entry) => entry.event)).toEqual(["GENERATED", "REPRINTED"]);
    expect(text(r)).toMatch(/PDF history \(2\)/);
    expect(text(r)).toMatch(/downloaded and recorded in the PDF history/);
  });

  test("a letter emailed before the register existed is listed but cannot be reprinted", async () => {
    const { api } = setup();
    api.seedReconciliation([{ sentOn: "2026-10-08", maskedRecipient: "c•••@example.test", candidateLabel: "Synthetic Candidate" }]);
    const item = (await api.listReconciliation("ALL", null)).items[0];
    const created = await api.createReconciliationIdentity(item.id, true, key());
    const r = await show(api, created.linkedPerson.id);
    expect(text(r)).toMatch(/emailed before the register existed/);
    expect(hasButton(r, /Download version 1 PDF/)).toBe(false);
  });
});

describe("PersonTimeline — audit trail", () => {
  test("is loaded on demand, newest first, with older entries on request", async () => {
    const { api } = setup({ auditPageSize: 2 });
    const { person } = await joinedEmployee(api);
    const r = await show(api, person.id);
    expect(api.calls).not.toContain("listAudit");
    await click(r, /Show audit trail/);
    expect(api.calls.filter((c) => c === "listAudit")).toHaveLength(1);
    const first = text(r);
    expect(first).toMatch(/JOINED/);
    expect(first).toMatch(/Synthetic HR Admin/);
    expect(first).toMatch(/IST/);
    expect(first).not.toMatch(/OFFER_ISSUED/);
    await click(r, /Load older entries/);
    expect(text(r)).toMatch(/OFFER_ISSUED/);
    expect(text(r)).toMatch(/OFFER_ACCEPTED/);
  });
});
