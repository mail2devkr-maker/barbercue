import ReconciliationWorklist from "../ReconciliationWorklist";
import { ApiError } from "../../../lib/api";
import { createFakeRegister } from "../../../lib/hr-register/__tests__/fake-register";
import { act, button, click, flush, hasButton, mount, setChecked, setValue, text } from "../../../lib/hr-register/__tests__/helpers";

const failWithApiError = (status, code, message) => {
  throw new ApiError(status, { error: { code, message } });
};

/** Ten synthetic recipients over 8-21 October, one of them a forward of an earlier letter. */
function historicalItems() {
  const rows = [];
  for (let i = 1; i <= 10; i += 1) {
    rows.push({ sentOn: `2026-10-${String(7 + i).padStart(2, "0")}`, maskedRecipient: `c${"•".repeat(3)}${String(i).padStart(2, "0")}@example.test`, candidateLabel: `Synthetic Candidate ${String(i).padStart(2, "0")}` });
  }
  return rows;
}

function setup() {
  const api = createFakeRegister({ fail: failWithApiError });
  api.seedReconciliation(historicalItems());
  return api;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("ReconciliationWorklist — historical emails are unverified, not people", () => {
  test("all ten letters appear as UNVERIFIED and no employee ID is shown or invented", async () => {
    const api = setup();
    const r = await mount(<ReconciliationWorklist api={api} />);
    const t = text(r);
    expect(t.match(/ID UNVERIFIED/g)).toHaveLength(10);
    expect(t).not.toMatch(/FQ-FE-\d{5}/);
    expect(t).toMatch(/Nothing is guessed from names or e-mail addresses/);
    expect(t).toMatch(/Acceptance evidence None — unknown/);
    expect(t).not.toMatch(/@gmail|@yahoo/);
    expect(api.people.size).toBe(0);
    expect(api.usedCodes.size).toBe(2); // only the two synthetic manager accounts exist
  });

  test("linking needs a code that really exists in the register; typing one never creates an ID", async () => {
    const api = setup();
    const person = api.seedPerson({ fullName: "Existing Employee" });
    api.seedOffer(person, { role: "Field Sales Executive", baseSalaryInr: 20000, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: null });
    const r = await mount(<ReconciliationWorklist api={api} />);

    await click(r, /Link to an existing ID/);
    await setValue(r, /Employee ID from the original letter/, "banana");
    await click(r, /^Link$/);
    expect(text(r)).toMatch(/Enter the employee ID printed on the original letter/);

    await setValue(r, /Employee ID from the original letter/, "FQ-FE-09999");
    await click(r, /^Link$/);
    expect(text(r)).toMatch(/No one in the register has FQ-FE-09999/);
    expect(api.calls).not.toContain("linkReconciliation");
    expect(api.people.size).toBe(1);

    await setValue(r, /Employee ID from the original letter/, person.employeeCode.slice(-5));
    await click(r, /^Link$/);
    expect(api.calls).toContain("linkReconciliation");
    expect(text(r)).toMatch(new RegExp(`Linked to ${person.employeeCode}`));
    expect(text(r).match(/ID UNVERIFIED/g)).toHaveLength(9);
    expect(api.people.size).toBe(1);
  });

  test("a forward is marked as a duplicate and never becomes a second person", async () => {
    const api = setup();
    const r = await mount(<ReconciliationWorklist api={api} />);
    await click(r, /Mark as duplicate/);
    expect(button(r, /^Mark as duplicate$/).props.disabled).toBe(true);
    const items = (await api.listReconciliation("ALL", null)).items;
    await setValue(r, /This is a forward \/ resend of/, items[1].id);
    await click(r, /^Mark as duplicate$/);
    expect(text(r)).toMatch(/No second person was created/);
    expect(api.people.size).toBe(0);
  });

  test("creating an identity from a letter requires the 'history checked' statement and only then allocates a code", async () => {
    const api = setup();
    const r = await mount(<ReconciliationWorklist api={api} />);
    await click(r, /No earlier record found/);
    expect(text(r)).toMatch(/only if no earlier ID exists/);
    expect(button(r, /^Create identity$/).props.disabled).toBe(true);
    expect(api.people.size).toBe(0);
    await setChecked(r, /I checked the history/);
    await click(r, /^Create identity$/);
    expect(api.people.size).toBe(1);
    expect([...api.people.values()][0].employeeCode).toBe("FQ-FE-00101");
    expect(text(r)).toMatch(/New identity created from this letter/);
  });

  test("a failure is shown and leaves the item untouched", async () => {
    const api = setup();
    api.markReconciliationDuplicate = async () => {
      throw new ApiError(409, { error: { code: "X", message: "m" } });
    };
    const r = await mount(<ReconciliationWorklist api={api} />);
    const items = (await api.listReconciliation("ALL", null)).items;
    await click(r, /Mark as duplicate/);
    await setValue(r, /This is a forward \/ resend of/, items[1].id);
    await click(r, /^Mark as duplicate$/);
    expect(text(r)).toMatch(/record changed/);
    expect(text(r).match(/ID UNVERIFIED/g)).toHaveLength(10);
  });

  test("filtering by status reloads the list", async () => {
    const api = setup();
    const r = await mount(<ReconciliationWorklist api={api} />);
    const select = r.root.findAllByType("select")[0];
    await act(async () => {
      select.props.onChange({ target: { value: "LINKED" } });
    });
    await flush();
    expect(text(r)).toMatch(/Nothing to reconcile for this filter/);
    expect(hasButton(r, /Link to an existing ID/)).toBe(false);
  });
});
