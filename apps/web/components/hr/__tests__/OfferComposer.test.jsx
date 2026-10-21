import OfferComposer from "../OfferComposer";
import { ApiError } from "../../../lib/api";
import { sha256Hex } from "../../../lib/hr-register/pdf";
import { createFakeRegister } from "../../../lib/hr-register/__tests__/fake-register";
import { act, button, click, field, flush, hasButton, mount, setChecked, setValue, spyOnKeys, submit, text } from "../../../lib/hr-register/__tests__/helpers";

const failWithApiError = (status, code, message) => {
  throw new ApiError(status, { error: { code, message } });
};

const drawn = (bytes) =>
  [...new TextDecoder().decode(bytes).matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, "$1")).join(" ");

function setup(extra = {}) {
  const api = createFakeRegister({ fail: failWithApiError });
  const delivered = [];
  const deliverPdf = (bytes, filename) => delivered.push({ bytes, filename });
  return { api, delivered, deliverPdf, ...extra };
}

async function fillCandidate(r, { name = "Asha Kumar", email = "", phone = "" } = {}) {
  await setValue(r, /Candidate name/, name);
  if (email) await setValue(r, /^Email/, email);
  if (phone) await setValue(r, /^Phone/, phone);
}

async function fillTerms(r, salary = "50000") {
  await setValue(r, /Base salary/, salary);
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("OfferComposer — identity first, saved offer before PDF", () => {
  test("there is no free-text employee number: the ID is read-only and assigned by the register", async () => {
    const { api } = setup();
    const r = await mount(<OfferComposer api={api} />);
    expect(text(r)).not.toMatch(/Employee number/i);
    expect(text(r)).not.toMatch(/Generated later if blank/);
    const idField = field(r, /^Employee ID/);
    expect(idField.props.readOnly).toBe(true);
    expect(idField.props.value).toBe("Assigned by the register when you save");
    const incentive = field(r, /Expected Performance Incentive/);
    expect(incentive.props.readOnly).toBe(true);
    expect(incentive.props.value).toBe("INR 5,000 per month (standard)");
  });

  test("terms and saving stay locked until HR has checked existing records and decided who this is", async () => {
    const { api } = setup();
    const r = await mount(<OfferComposer api={api} />);
    expect(button(r, /Save offer/).props.disabled).toBe(true);
    await fillCandidate(r);
    await fillTerms(r);
    await submit(r);
    expect(api.calls).not.toContain("createOffer");
    expect(text(r)).toMatch(/Check existing records and confirm who this candidate is/);
  });

  test("a new candidate: check → confirm → save creates one offer, then the PDF carries the returned code", async () => {
    const { api, delivered, deliverPdf } = setup();
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r, { email: "asha@example.test", phone: "9000000001" });
    await click(r, /Check existing records/);
    expect(text(r)).toMatch(/No existing candidate, offer or employee matched/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r, "50,000");
    await setValue(r, /Proposed joining date/, "2026-11-02");
    await submit(r);

    const creates = api.calls.filter((c) => c === "createOffer");
    expect(creates).toHaveLength(1);
    const [person] = [...api.people.values()];
    expect(person.employeeCode).toBe("FQ-FE-00101");
    expect(text(r)).toMatch(/Offer saved as version 1/);
    expect(text(r)).toMatch(/FQ-FE-00101/);

    // The PDF is generated from the saved version and recorded in its history.
    expect(delivered).toHaveLength(1);
    expect(delivered[0].filename).toBe("FastQue-Offer-FQ-FE-00101-v1.pdf");
    expect(drawn(delivered[0].bytes)).toContain("Employee No: FQ-FE-00101");
    expect(drawn(delivered[0].bytes)).not.toContain("Pending onboarding");
    const offer = [...api.offers.values()][0];
    expect(offer.pdfHistory).toHaveLength(1);
    expect(offer.pdfHistory[0].sha256).toBe(await sha256Hex(delivered[0].bytes));
    expect(text(r)).toMatch(/FastQue does not send email/);
  });

  test("the saved request carries the typed terms and the default role", async () => {
    const { api, deliverPdf } = setup();
    let seen;
    const original = api.createOffer.bind(api);
    api.createOffer = (input, key) => {
      seen = input;
      return original(input, key);
    };
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r, "24000");
    await setValue(r, /Sales Target/, "120");
    await setValue(r, /Incentives Beyond Target/, "150");
    await submit(r);
    expect(seen.identity).toMatchObject({ mode: "NEW", person: { fullName: "Asha Kumar" } });
    expect(seen.identity.decisionToken).toMatch(/^tok-/);
    expect(seen.terms).toMatchObject({
      role: "Field Sales Executive",
      baseSalaryInr: 24000,
      salaryBasis: "monthly",
      salesTarget: 120,
      incentiveBeyondTargetInr: 150,
      proposedJoiningDate: null,
      reportingManagerId: null,
    });
  });

  test("a double click saves exactly one offer", async () => {
    const { api, deliverPdf } = setup();
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r);
    const form = r.root.findAllByType("form")[0];
    await act(async () => {
      form.props.onSubmit({ preventDefault() {} });
      form.props.onSubmit({ preventDefault() {} });
    });
    await flush();
    expect(api.calls.filter((c) => c === "createOffer")).toHaveLength(1);
    expect(api.people.size).toBe(1);
    expect(api.offers.size).toBe(1);
  });

  test("a failed save keeps the same idempotency key for the retry, and never shows a code", async () => {
    const { api, deliverPdf } = setup();
    let fail = true;
    const original = api.createOffer.bind(api);
    api.createOffer = (input, key) => {
      if (fail) return Promise.reject(new ApiError(503, { error: { code: "X", message: "down" } }));
      return original(input, key);
    };
    const keys = spyOnKeys(api); // wraps the override so both attempts are recorded
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r);
    await submit(r);
    expect(text(r)).toMatch(/temporarily unavailable\. Nothing was saved/);
    expect(text(r)).not.toMatch(/FQ-FE-00101/);
    expect(api.people.size).toBe(0);

    fail = false;
    await submit(r);
    expect(text(r)).toMatch(/Offer saved as version 1/);
    const attempts = keys.filter((k) => k.name === "createOffer");
    expect(attempts.length).toBe(2);
    expect(attempts[0].key).toBe(attempts[1].key);
  });

  test("rejects invalid terms before any request", async () => {
    const { api } = setup();
    const r = await mount(<OfferComposer api={api} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);

    await fillTerms(r, "0");
    await submit(r);
    expect(text(r)).toMatch(/valid base salary/);

    await fillTerms(r, "30000");
    await setValue(r, /Sales Target/, "100");
    await submit(r);
    expect(text(r)).toMatch(/both Sales Target and Incentives Beyond Target/);

    await setValue(r, /Incentives Beyond Target/, "2000000");
    await submit(r);
    expect(text(r)).toMatch(/positive whole rupee amount/);
    expect(api.calls).not.toContain("createOffer");
  });

  test("PDF failure after a successful save leaves the offer saved and offers a retry", async () => {
    const { api, delivered } = setup();
    let first = true;
    const deliverPdf = (bytes, filename) => {
      if (first) {
        first = false;
        throw new Error("blocked download");
      }
      delivered.push({ bytes, filename });
    };
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r);
    await submit(r);
    expect(text(r)).toMatch(/Offer saved as version 1/);
    expect(text(r)).toMatch(/offer is saved, but the PDF could not be generated/);
    expect(api.offers.size).toBe(1);
    await click(r, /Generate PDF/);
    expect(delivered).toHaveLength(1);
    expect(api.calls.filter((c) => c === "createOffer")).toHaveLength(1);
  });

  test("'Record as emailed' only records; it does not send anything", async () => {
    const { api, deliverPdf } = setup();
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r);
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await fillTerms(r);
    await submit(r);
    await click(r, /^Record as emailed/);
    expect(api.calls).toContain("transitionOffer");
    expect([...api.offers.values()][0].status).toBe("SENT");
    expect(text(r)).toMatch(/Recorded as emailed/);
    expect(text(r)).toMatch(/does not send email/);
  });
});

describe("OfferComposer — known people are never silently merged or duplicated", () => {
  function seedKnown(api) {
    const person = api.seedPerson({ fullName: "Asha Kumar", email: "asha@example.test", phone: "9000000001" });
    const offer = api.seedOffer(person, { role: "Field Sales Executive", baseSalaryInr: 20000, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: null });
    return { person, offer };
  }

  test("a matching candidate is shown with masked contacts, and nothing is chosen for HR", async () => {
    const { api } = setup();
    const { person } = seedKnown(api);
    const r = await mount(<OfferComposer api={api} />);
    await fillCandidate(r, { name: "Asha Kumar", email: "asha@example.test" });
    await click(r, /Check existing records/);
    const t = text(r);
    expect(t).toContain(person.employeeCode);
    expect(t).toMatch(/Strong match/);
    expect(t).toMatch(/Same email/);
    expect(t).not.toContain("asha@example.test");
    expect(t).not.toContain("9000000001");
    expect(t).not.toMatch(/Using existing identity/);
    expect(button(r, /Save offer/).props.disabled).toBe(true);
  });

  test("same name, new mobile, reused email: the person is flagged but a different person needs a recorded reason", async () => {
    const { api, deliverPdf } = setup();
    seedKnown(api);
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r, { name: "Asha Kumar", email: "asha@example.test", phone: "9111111111" });
    await click(r, /Check existing records/);
    expect(text(r)).toMatch(/too close to create a new identity without a recorded reason/);

    // Blocked until both the acknowledgement and a reason exist.
    expect(button(r, /Create a new identity/).props.disabled).toBe(true);
    await setChecked(r, /I compared these records/);
    expect(button(r, /Create a new identity/).props.disabled).toBe(true);
    await setValue(r, /Why is this a different person/, "ok");
    expect(button(r, /Create a new identity/).props.disabled).toBe(true);
    await setValue(r, /Why is this a different person/, "Different Asha: different city and employer");
    expect(button(r, /Create a new identity/).props.disabled).toBe(false);
    await click(r, /Create a new identity/);
    expect(text(r)).toMatch(/New identity confirmed with a recorded reason/);

    let sent;
    const original = api.createOffer.bind(api);
    api.createOffer = (input, key) => {
      sent = input;
      return original(input, key);
    };
    await fillTerms(r);
    await submit(r);
    expect(sent.identity.overrideReason).toBe("Different Asha: different city and employer");
    expect(api.people.size).toBe(2);
  });

  test("choosing the existing person reuses the exact code and creates a new version, not a new person", async () => {
    const { api, deliverPdf } = setup();
    const { person, offer } = seedKnown(api);
    await api.transitionOffer(offer.id, "DECLINED", "Joined elsewhere", "k-decline");
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r, { name: "Asha Kumar", email: "asha@example.test" });
    await click(r, /Check existing records/);
    await click(r, new RegExp(`Same person — reuse ${person.employeeCode}`));
    expect(text(r)).toMatch(new RegExp(`Using existing identity ${person.employeeCode}`));
    expect(field(r, /^Employee ID/).props.value).toMatch(new RegExp(`${person.employeeCode} — existing ID will be reused`));
    await fillTerms(r, "26000");
    await submit(r);
    expect(api.people.size).toBe(1);
    expect(api.usedCodes.has("FQ-FE-00102")).toBe(false);
    expect(text(r)).toMatch(/Offer saved as version 2/);
    expect(text(r)).toContain(person.employeeCode);
    const versions = [...api.offers.values()].map((o) => [o.version, o.status, o.supersededByVersion]);
    expect(versions).toEqual([[1, "DECLINED", 2], [2, "ISSUED", null]]);
  });

  test("a person with an open offer cannot be given a second one", async () => {
    const { api, deliverPdf } = setup();
    const { person } = seedKnown(api);
    const r = await mount(<OfferComposer api={api} deliverPdf={deliverPdf} />);
    await fillCandidate(r, { name: "Asha Kumar", email: "asha@example.test" });
    await click(r, /Check existing records/);
    await click(r, new RegExp(`Same person — reuse ${person.employeeCode}`));
    await fillTerms(r);
    await submit(r);
    expect(text(r)).toMatch(/already has an open offer/);
    expect(api.offers.size).toBe(1);
  });

  test("changing the candidate's details after the check discards the decision", async () => {
    const { api } = setup();
    seedKnown(api);
    const r = await mount(<OfferComposer api={api} />);
    await fillCandidate(r, { name: "Asha Kumar", email: "asha@example.test" });
    await click(r, /Check existing records/);
    await click(r, /Same person — reuse/);
    expect(text(r)).toMatch(/Using existing identity/);
    await setValue(r, /^Email/, "other@example.test");
    expect(text(r)).not.toMatch(/Using existing identity/);
    expect(button(r, /Save offer/).props.disabled).toBe(true);
  });
});

describe("OfferComposer — re-offer and rehire for a person chosen in the register", () => {
  test("a preset person fixes the identity and the code; the match call carries only the code", async () => {
    const { api, deliverPdf } = setup();
    const person = api.seedPerson({ fullName: "Ravi Verma", email: "ravi@example.test" });
    const offer = api.seedOffer(person, { role: "Field Sales Executive", baseSalaryInr: 20000, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: "Patna" });
    await api.transitionOffer(offer.id, "ACCEPTED", null, "k1");
    await api.recordJoining(offer.id, { joinedOn: "2026-05-01", temporaryPassword: "pw-not-checked" }, "k2");
    const active = [...api.offers.values()][0];
    const episodeId = active.employmentEpisodeId;
    await api.recordExit(episodeId, { exitedOn: "2026-09-30", reason: "Resigned" }, "k3");

    const summary = (await api.search({ q: "", employeeCode: "", lifecycle: "ALL", offerStatus: "ALL", city: "", managerId: "", issuedFrom: "", issuedTo: "" }, null)).items[0];
    let matchQuery;
    const matchOriginal = api.matchIdentity.bind(api);
    api.matchIdentity = (q) => {
      matchQuery = q;
      return matchOriginal(q);
    };
    const r = await mount(<OfferComposer api={api} presetPerson={summary} deliverPdf={deliverPdf} />);
    expect(matchQuery).toEqual({ employeeCode: summary.employeeCode });
    expect(text(r)).toMatch(/Re-offering/);
    expect(text(r)).toContain(summary.employeeCode);
    expect(hasButton(r, /Check existing records/)).toBe(false);
    expect(field(r, /^Employee ID/).props.value).toMatch(/existing ID will be reused/);

    await fillTerms(r, "30000");
    await submit(r);
    expect(api.people.size).toBe(1);
    expect(text(r)).toMatch(/Offer saved as version 2/);
    const latest = [...api.offers.values()][1];
    expect(latest.kind).toBe("REHIRE");
    expect(latest.employmentEpisodeId).not.toBe(episodeId);
  });
});
