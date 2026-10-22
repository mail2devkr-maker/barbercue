import { apiFetch } from "../../api";
import { HR_PATHS, httpHrRegisterApi } from "../api";

jest.mock("../../api", () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error {} }));

const EMPTY = { q: "", employeeCode: "", lifecycle: "ALL", offerStatus: "ALL", city: "", managerId: "", issuedFrom: "", issuedTo: "" };

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
});

describe("httpHrRegisterApi", () => {
  test("search is a POST with only the filters that are set in the body, so nothing typed reaches a URL", async () => {
    await httpHrRegisterApi.search({ ...EMPTY, q: " asha@example.test ", lifecycle: "NOT_JOINED", city: "Patna" }, "25");
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe(`${HR_PATHS.register}/search`);
    expect(path).not.toMatch(/asha|@|\?/i);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ q: "asha@example.test", lifecycle: "NOT_JOINED", city: "Patna", cursor: "25", limit: 25 });
  });

  test("search leaves out empty and ALL filters", async () => {
    await httpHrRegisterApi.search({ ...EMPTY }, null);
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ limit: 25 });
  });

  test("identity matching is a POST so contact values never reach a URL", async () => {
    await httpHrRegisterApi.matchIdentity({ fullName: "Asha Kumar", email: "asha@example.test", phone: "9000000001" });
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe(HR_PATHS.matches);
    expect(path).not.toMatch(/asha|9000000001|@/i);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ fullName: "Asha Kumar", email: "asha@example.test", phone: "9000000001" });
  });

  test("no GET URL anywhere carries a name, email or phone", async () => {
    await httpHrRegisterApi.getPerson("p-1");
    await httpHrRegisterApi.listAudit("p-1", null);
    await httpHrRegisterApi.listReconciliation("UNVERIFIED", null);
    await httpHrRegisterApi.getLetterData("o-1");
    for (const [path] of apiFetch.mock.calls) expect(path).not.toMatch(/@|\d{10}/);
  });

  test.each([
    ["createOffer", [{ identity: { mode: "NEW" }, terms: {} }, "k-1"], "POST", HR_PATHS.offers],
    ["transitionOffer", ["o 1", "SENT", null, "k-1"], "POST", `${HR_PATHS.offers}/o%201/status`],
    ["recordJoining", ["o-1", { joinedOn: "2026-10-22", temporaryPassword: "x" }, "k-1"], "POST", `${HR_PATHS.offers}/o-1/joining`],
    ["recordNotJoined", ["o-1", { decidedOn: "2026-10-22", reason: "No show" }, "k-1"], "POST", `${HR_PATHS.offers}/o-1/not-joined`],
    ["recordExit", ["e-1", { exitedOn: "2026-10-22", reason: "Resigned" }, "k-1"], "POST", `${HR_PATHS.episodes}/e-1/exit`],
    ["recordPdfEvent", ["o-1", { event: "GENERATED", sha256: "a".repeat(64), byteLength: 10 }, "k-1"], "POST", `${HR_PATHS.offers}/o-1/pdf-events`],
    ["linkReconciliation", ["r-1", "p-1", "k-1"], "POST", `${HR_PATHS.reconciliation}/r-1/link`],
    ["markReconciliationDuplicate", ["r-1", "r-2", "k-1"], "POST", `${HR_PATHS.reconciliation}/r-1/duplicate`],
    ["createReconciliationIdentity", ["r-1", true, "k-1"], "POST", `${HR_PATHS.reconciliation}/r-1/create-identity`],
  ])("%s sends its Idempotency-Key to %s", async (method, args, verb, path) => {
    await httpHrRegisterApi[method](...args);
    const [calledPath, options] = apiFetch.mock.calls[0];
    expect(calledPath).toBe(path);
    expect(options.method).toBe(verb);
    expect(options.headers).toEqual({ "Idempotency-Key": "k-1" });
  });

  test("the manager list reuses the existing employees endpoint and offers only active accounts", async () => {
    apiFetch.mockResolvedValue([
      { id: "m1", fullName: "Active One", employeeCode: "FQ-FE-00150", status: "ACTIVE", email: "x" },
      { id: "m2", fullName: "Suspended Two", employeeCode: "FQ-FE-00151", status: "SUSPENDED" },
    ]);
    const managers = await httpHrRegisterApi.listManagers();
    expect(apiFetch).toHaveBeenCalledWith(HR_PATHS.employees);
    expect(managers).toEqual([{ id: "m1", fullName: "Active One", employeeCode: "FQ-FE-00150" }]);
  });
});
