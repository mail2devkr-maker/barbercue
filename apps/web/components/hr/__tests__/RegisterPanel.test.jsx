import RegisterPanel from "../RegisterPanel";
import { ApiError } from "../../../lib/api";
import { createFakeRegister } from "../../../lib/hr-register/__tests__/fake-register";
import { act, click, flush, mount, setValue, submit, text } from "../../../lib/hr-register/__tests__/helpers";

const failWithApiError = (status, code, message) => {
  throw new ApiError(status, { error: { code, message } });
};

const TERMS = { role: "Field Sales Executive", baseSalaryInr: 20000, salaryBasis: "monthly", salesTarget: null, incentiveBeyondTargetInr: null, proposedJoiningDate: null, reportingManagerId: null, city: "Patna" };

function seed(api, count) {
  for (let i = 1; i <= count; i += 1) {
    const person = api.seedPerson({ fullName: `Person ${String(i).padStart(2, "0")}`, email: `p${i}@example.test`, phone: `90000000${String(i).padStart(2, "0")}` });
    api.seedOffer(person, { ...TERMS, city: i % 2 ? "Patna" : "Delhi" });
  }
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

describe("RegisterPanel", () => {
  test("lists people with permanent codes and masked contacts only", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 3);
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    const t = text(r);
    expect(t).toMatch(/3 people/);
    expect(t).toContain("FQ-FE-00101");
    expect(t).toContain("FQ-FE-00103");
    expect(t).not.toContain("p1@example.test");
    expect(t).not.toContain("9000000001");
    expect(t).toMatch(/p•+@example\.test/);
  });

  test("a short employee number is normalised to the canonical code; junk is rejected without a request", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 3);
    const seen = [];
    const original = api.search.bind(api);
    api.search = (filters, cursor) => {
      seen.push(filters);
      return original(filters, cursor);
    };
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    const before = seen.length;

    await setValue(r, /^Employee ID/, "not-a-code");
    await submit(r);
    expect(text(r)).toMatch(/Enter an employee ID like FQ-FE-00123/);
    expect(seen.length).toBe(before);

    await setValue(r, /^Employee ID/, "102");
    await submit(r);
    expect(seen[seen.length - 1].employeeCode).toBe("FQ-FE-00102");
    expect(text(r)).toMatch(/1 person/);
    expect(text(r)).toContain("Person 02");
    expect(text(r)).not.toContain("Person 01");
  });

  test("filters combine: stage, offer status and city narrow the list", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 4);
    const first = [...api.offers.values()][0];
    await api.transitionOffer(first.id, "DECLINED", "Joined elsewhere", "k-1");
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    await setValue(r, /Latest offer/, "DECLINED");
    await submit(r);
    expect(text(r)).toMatch(/1 person/);
    await setValue(r, /Latest offer/, "ALL");
    await setValue(r, /^City/, "delhi");
    await submit(r);
    expect(text(r)).toMatch(/2 people/);
    await click(r, /^Clear$/);
    expect(text(r)).toMatch(/4 people/);
  });

  test("results are paged with a cursor", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 30);
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    expect(text(r)).toMatch(/30 people/);
    expect(text(r)).not.toContain("Person 30");
    await click(r, /Load more/);
    expect(text(r)).toContain("Person 30");
  });

  test("opening a record reports the person and marks the selection", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 2);
    const onSelect = jest.fn();
    const r = await mount(<RegisterPanel api={api} onSelect={onSelect} />);
    await click(r, /Open record/);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].employeeCode).toBe("FQ-FE-00101");
  });

  test("a failed load says so instead of showing an empty register", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    api.search = async () => {
      throw new ApiError(503, { error: { code: "X", message: "m" } });
    };
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    expect(text(r)).toMatch(/temporarily unavailable/);
    expect(text(r)).not.toMatch(/No one in the register matches/);
  });

  test("an older, slower response never overwrites a newer search", async () => {
    const api = createFakeRegister({ fail: failWithApiError });
    seed(api, 3);
    const original = api.search.bind(api);
    const gates = [];
    api.search = (filters, cursor) =>
      new Promise((resolve) => {
        gates.push(() => resolve(original(filters, cursor)));
      });
    const r = await mount(<RegisterPanel api={api} onSelect={() => {}} />);
    // Request 1 (initial, empty filters) is still pending; start request 2 for Person 03.
    await setValue(r, /Name, email or phone/, "Person 03");
    await submit(r);
    await act(async () => {
      gates[1]();
    });
    await flush();
    await act(async () => {
      gates[0]();
    });
    await flush();
    expect(text(r)).toMatch(/1 person/);
    expect(text(r)).toContain("Person 03");
    expect(text(r)).not.toContain("Person 01");
  });
});
