import { Role } from "@barbercue/shared";
import HrWorkbench from "../HrWorkbench";
import { ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { createFakeRegister } from "../../../lib/hr-register/__tests__/fake-register";
import { click, hasButton, mount, setValue, submit, text } from "../../../lib/hr-register/__tests__/helpers";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const failWithApiError = (status, code, message) => {
  throw new ApiError(status, { error: { code, message } });
};

const TERMS = { role: "Field Sales Executive", baseSalaryInr: 21000, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: "Mumbai" };

let n = 0;
const key = () => `wb-${++n}`;

async function exitedEmployee(api) {
  const person = api.seedPerson({ fullName: "Karan Mehta", email: "karan@example.test", phone: "9000000004" });
  const offer = api.seedOffer(person, TERMS);
  await api.transitionOffer(offer.id, "ACCEPTED", null, key());
  const joined = await api.recordJoining(offer.id, { joinedOn: "2026-02-02", temporaryPassword: "synthetic-pass" }, key());
  await api.recordExit(joined.episodes[0].id, { exitedOn: "2026-09-12", reason: "Resigned" }, key());
  return person;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.window = { location: { search: "" }, requestAnimationFrame: (callback) => callback() };
  globalThis.document = { getElementById: () => null };
  useAuth.mockReturnValue({ status: "authenticated", user: { roles: [Role.HR_ADMIN] } });
});

afterEach(() => {
  delete globalThis.window;
  delete globalThis.document;
});

describe("HrWorkbench", () => {
  test("starting a rehire after another offer was just saved gives a fresh, working form", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    const karan = await exitedEmployee(api);
    const r = await mount(<HrWorkbench api={api} />);

    // Save a different candidate's offer first so the composer is showing its "offer saved" card.
    await setValue(r, /Candidate name/, "Synthetic Newhire");
    await click(r, /Check existing records/);
    await click(r, /Continue as a new candidate/);
    await setValue(r, /Base salary/, "30000");
    await submit(r);
    expect(text(r)).toMatch(/Offer saved as version 1/);
    expect(hasButton(r, /Save offer/)).toBe(false);

    // Open Karan's record and issue the rehire offer from the timeline.
    await click(r, /Open record/);
    await click(r, /Issue a rehire offer/);

    const t = text(r);
    expect(t).not.toMatch(/Offer saved as version 1/);
    expect(t).toMatch(/Re-offering/);
    expect(t).toContain(karan.employeeCode);
    expect(hasButton(r, /Save offer/)).toBe(true);
  });

  test("an unavailable register shows only the fail-closed notice, with no composer and no manual ID", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    api.probe = async () => {
      throw new ApiError(404, { error: { code: "NOT_FOUND", message: "Not found" } });
    };
    const r = await mount(<HrWorkbench api={api} />);
    const t = text(r);
    expect(t).toMatch(/not available on this server yet/);
    expect(t).not.toMatch(/Offer letter generator/);
    expect(t).not.toMatch(/Employee number/i);
    expect(api.calls).not.toContain("search");
    expect(api.calls).not.toContain("listReconciliation");
  });

  test("?code= opens the register already filtered to that employee ID", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    await exitedEmployee(api);
    const other = api.seedPerson({ fullName: "Someone Else" });
    api.seedOffer(other, TERMS);
    globalThis.window.location.search = "?code=101";
    const r = await mount(<HrWorkbench api={api} />);
    expect(text(r)).toMatch(/1 person/);
    expect(text(r)).toContain("Karan Mehta");
    expect(text(r)).not.toContain("Someone Else");
  });
});
