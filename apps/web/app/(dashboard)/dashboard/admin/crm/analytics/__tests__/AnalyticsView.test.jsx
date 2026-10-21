import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import AnalyticsView from "../AnalyticsView";
import { apiFetch, ApiError } from "../../../../../../../lib/api";
import { useAuth } from "../../../../../../../lib/auth-context";

jest.mock("../../../../../../../components/ui/Button", () => ({
  LinkButton: ({ children, href }) => <a href={href}>{children}</a>,
}));
jest.mock("../../../../../../../lib/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../../../../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const DAY_MS = 86_400_000;
const EMP1 = "11111111-1111-4111-8111-111111111111";
const EMP2 = "22222222-2222-4222-8222-222222222222";

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const wait = async (ms) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const byId = (r, id) => r.root.findAll((n) => typeof n.type === "string" && n.props.id === id)[0];
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const query = (path) => new URLSearchParams(path.split("?")[1]);
const change = async (r, id, value) => { await act(async () => { byId(r, id).props.onChange({ target: { value } }); }); };
const click = async (r, label) => { await act(async () => { button(r, label).props.onClick(); }); await flush(); };

const employee = (id, code, territory, over = {}) => ({
  employeeId: id, employeeCode: code, territory, status: "ACTIVE", leadsCreated: 3, onboardedFromPeriodLeads: 1, leadsOnboardedInPeriod: 1,
  visits: 7, followUpsCompleted: 4, openFollowUpsOverdueInPeriod: 0, conversionPercent: 33.3, ...over,
});
const analytics = (over = {}) => ({
  from: "2026-09-22T00:00:00.000Z",
  to: "2026-10-22T00:00:00.000Z",
  generatedAt: "2026-10-21T04:00:00.000Z",
  totals: { leadsCreated: 12, onboardedFromPeriodLeads: 4, leadsOnboardedInPeriod: 3, visits: 28, followUpsCompleted: 17, openFollowUpsOverdueInPeriod: 2 },
  employees: [employee(EMP1, "FQ-FE-00101", "Patna"), employee(EMP2, "FQ-FE-00102", null, { leadsCreated: 9, conversionPercent: 11.1, visits: 1 })],
  territories: [
    { territory: "Patna", employees: 1, leadsCreated: 3, onboardedFromPeriodLeads: 1, leadsOnboardedInPeriod: 1, visits: 7, followUpsCompleted: 4, openFollowUpsOverdueInPeriod: 0, conversionPercent: 33.3 },
    { territory: null, employees: 1, leadsCreated: 9, onboardedFromPeriodLeads: 1, leadsOnboardedInPeriod: 0, visits: 1, followUpsCompleted: 0, openFollowUpsOverdueInPeriod: 2, conversionPercent: 11.1 },
  ],
  ...over,
});
const who = { id: EMP1, employeeCode: "FQ-FE-00101", fullName: "Asha Verma", territory: "Patna" };
const lead = (n, over = {}) => ({
  id: `l${n}`, shopName: `Shop ${n}`, contactName: `Owner ${n}`, phone: `+91900000000${n}`, email: null, city: "Patna", locality: "Boring Road", addressLine: "12 Hidden Street",
  source: "FIELD_VISIT", status: "INTERESTED", notes: "SECRET NOTE", lostReason: null, onboardedAt: null, onboardedSalon: null,
  createdAt: "2026-10-10T05:00:00.000Z", updatedAt: "2026-10-10T05:00:00.000Z", employee: who, ...over,
});
const visit = (n, over = {}) => ({ id: `v${n}`, leadId: null, leadShopName: null, shopName: `Visit shop ${n}`, visitedAt: "2026-10-11T05:00:00.000Z", outcome: "DEMO_COMPLETED", notes: "SECRET VISIT NOTE", createdAt: "2026-10-11T05:00:00.000Z", employee: who, ...over });
const followUp = (n, over = {}) => ({
  id: `f${n}`, leadId: "l1", leadShopName: `Follow shop ${n}`, dueAt: "2026-10-12T05:00:00.000Z", channel: "CALL", status: "OPEN", notes: "SECRET FOLLOW NOTE", outcome: null,
  completedAt: null, createdAt: "2026-10-01T05:00:00.000Z", updatedAt: "2026-10-01T05:00:00.000Z", employee: who, ...over,
});
const page = (items, nextCursor = null) => ({ items, nextCursor, limit: 25 });

let calls;
let handler;
function install(fn) {
  calls = [];
  handler = fn;
  apiFetch.mockImplementation(async (path) => {
    calls.push(path);
    return handler(path);
  });
}
const standard = (path) => {
  if (path.startsWith("admin/crm/analytics?")) return analytics();
  if (path.startsWith("admin/crm/leads/page?")) return page([lead(1), lead(2)]);
  if (path.startsWith("admin/crm/visits/page?")) return page([visit(1)]);
  if (path.startsWith("admin/crm/follow-ups/page?")) return page([followUp(1), followUp(2, { status: "COMPLETED", completedAt: "2026-10-12T06:00:00.000Z", dueAt: "2999-01-01T00:00:00.000Z" })]);
  throw new Error(`unexpected ${path}`);
};
const analyticsCalls = () => calls.filter((p) => p.startsWith("admin/crm/analytics?"));
const pageCalls = (kind) => calls.filter((p) => p.startsWith(`admin/crm/${kind}/page?`));

async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<AnalyticsView />); });
  await flush();
  return r;
}
const signIn = (roles) => useAuth.mockReturnValue({ user: { id: "u1", roles } });
const err = (status, code, message) => new ApiError(status, { error: { code, message } });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  signIn(["PLATFORM_ADMIN"]);
});

describe("access", () => {
  it("shows nothing and asks nothing of the server to an account that is not a platform admin", async () => {
    signIn(["CO_FOUNDER", "SALES_ADMIN"]);
    install(standard);
    const r = await mount();
    expect(text(r)).toContain("Only platform admins can see CRM analytics.");
    expect(calls).toHaveLength(0);
    expect(r.root.findAllByType("table")).toHaveLength(0);
  });

  it("renders nothing until the signed-in user is known", async () => {
    useAuth.mockReturnValue({ user: null });
    install(standard);
    const r = await mount();
    expect(r.toJSON()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("totals and tables", () => {
  it("asks for the last 30 whole UTC days as [from, to) and shows totals, employees and territories", async () => {
    install(standard);
    const r = await mount();
    const q = query(analyticsCalls()[0]);
    expect(q.get("from")).toMatch(/T00:00:00\.000Z$/);
    expect(q.get("to")).toMatch(/T00:00:00\.000Z$/);
    expect(Date.parse(q.get("to")) - Date.parse(q.get("from"))).toBe(30 * DAY_MS);
    // The end is midnight at the start of tomorrow in UTC: today is included.
    const ahead = Date.parse(q.get("to")) - Date.now();
    expect(ahead).toBeGreaterThan(0);
    expect(ahead).toBeLessThanOrEqual(DAY_MS);
    expect(q.has("employeeId")).toBe(false);

    const t = text(r);
    for (const label of ["Leads created", "Onboarded from these leads", "Onboarded in the period", "Visits", "Follow-ups completed", "Open follow-ups overdue"]) {
      expect(t).toContain(label);
    }
    expect(t).toContain("33.3% of the leads created");
    expect(t).toContain("FQ-FE-00101");
    expect(t).toContain("FQ-FE-00102");
    expect(t).toContain("Patna");
    expect(t).toContain("No territory");
    expect(t).toContain("generated");
    expect(t).toContain("UTC");
    expect(t).toContain("This screen only reads");
  });

  it("shows no name, email, phone or note in the analytics tables", async () => {
    install(standard);
    const r = await mount();
    const tables = r.root.findAllByType("table");
    const analyticsText = tables.slice(0, 2).map((tbl) => collect(tbl.children)).join(" ");
    expect(analyticsText).not.toMatch(/@|\+91|Asha|SECRET/);
  });

  it("sorts both tables on request", async () => {
    install(standard);
    const r = await mount();
    const order = () => { const t = collect(r.root.findAllByType("table")[0].children); return [t.indexOf("FQ-FE-00101"), t.indexOf("FQ-FE-00102")]; };
    let [a, b] = order();
    expect(a).toBeLessThan(b);
    await change(r, "crm-sort", "leads");
    [a, b] = order();
    expect(b).toBeLessThan(a);
  });

  it("states zero totals and an empty team plainly", async () => {
    install((path) => (path.startsWith("admin/crm/analytics?")
      ? analytics({ totals: { leadsCreated: 0, onboardedFromPeriodLeads: 0, leadsOnboardedInPeriod: 0, visits: 0, followUpsCompleted: 0, openFollowUpsOverdueInPeriod: 0 }, employees: [], territories: [] })
      : standard(path)));
    const r = await mount();
    const t = text(r);
    expect(t).toContain("No field employees to show for this selection.");
    expect(t).toContain("No territories to show for this selection.");
    expect(t).toContain("— of the leads created");
    expect(t).not.toMatch(/NaN|undefined|null/);
  });
});

describe("period and employee", () => {
  it("uses a preset's whole days", async () => {
    install(standard);
    const r = await mount();
    await click(r, "Last 7 days");
    expect(analyticsCalls()).toHaveLength(2);
    const q = query(analyticsCalls()[1]);
    expect(Date.parse(q.get("to")) - Date.parse(q.get("from"))).toBe(7 * DAY_MS);
    expect(button(r, "Last 7 days").props["aria-pressed"]).toBe(true);
    expect(button(r, "Last 30 days").props["aria-pressed"]).toBe(false);
  });

  it("sends a typed range as UTC instants with the last day included", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-from", "2026-10-01");
    await change(r, "crm-to", "2026-10-20");
    await flush();
    const q = query(analyticsCalls().at(-1));
    expect(q.get("from")).toBe("2026-10-01T00:00:00.000Z");
    expect(q.get("to")).toBe("2026-10-21T00:00:00.000Z");
    expect(button(r, "Last 30 days").props["aria-pressed"]).toBe(false);
  });

  it("does not ask the server for a reversed range, and says why", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-from", "2026-10-10");
    await change(r, "crm-to", "2026-10-01");
    await flush();
    expect(text(r)).toContain("The end date must be on or after the start date.");
    const before = analyticsCalls().length;
    await flush();
    expect(analyticsCalls()).toHaveLength(before);
    expect(text(r)).toContain("Fix the dates above");
    expect(r.root.findAllByType("table")).toHaveLength(0);
    // The totals of the earlier period are not left on screen under dates they do not belong to.
    expect(text(r)).not.toContain("Open follow-ups overdue");
  });

  it("does not ask the server for more than 366 days, and says so", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-from", "2025-01-01");
    await change(r, "crm-to", "2026-10-20");
    await flush();
    expect(text(r)).toMatch(/Choose 366 days or fewer\. You chose \d+\./);
    expect(analyticsCalls().every((p) => Date.parse(query(p).get("to")) - Date.parse(query(p).get("from")) <= 366 * DAY_MS)).toBe(true);
  });

  it("narrows to one employee for the totals and the rows, and keeps every employee in the list", async () => {
    install((path) => {
      if (path.startsWith("admin/crm/analytics?") && query(path).get("employeeId") === EMP1) {
        return analytics({ employees: [employee(EMP1, "FQ-FE-00101", "Patna")], territories: [] });
      }
      return standard(path);
    });
    const r = await mount();
    await change(r, "crm-employee", EMP1);
    await flush();
    expect(query(analyticsCalls().at(-1)).get("employeeId")).toBe(EMP1);
    expect(query(pageCalls("leads").at(-1)).get("employeeId")).toBe(EMP1);
    const options = byId(r, "crm-employee").findAllByType("option").map((o) => o.props.value);
    expect(options).toEqual(expect.arrayContaining(["ALL", EMP1, EMP2]));
  });

  it("drops an answer for a period that was replaced before it arrived", async () => {
    const pending = [];
    install((path) => {
      if (path.startsWith("admin/crm/analytics?")) return new Promise((resolve) => pending.push(resolve));
      return standard(path);
    });
    const r = await mount();
    expect(pending).toHaveLength(1);
    await click(r, "Last 7 days");
    expect(pending).toHaveLength(2);
    await act(async () => { pending[1](analytics({ totals: { ...analytics().totals, leadsCreated: 5 } })); });
    await act(async () => { pending[0](analytics({ totals: { ...analytics().totals, leadsCreated: 777 } })); });
    await flush();
    expect(text(r)).not.toContain("777");
    expect(text(r)).toContain("Leads created");
  });
});

describe("failures", () => {
  it("says a platform admin is needed when the server answers 403", async () => {
    install((path) => { if (path.startsWith("admin/crm/analytics?")) throw err(403, "FORBIDDEN", "Forbidden resource"); return standard(path); });
    const r = await mount();
    expect(text(r)).toContain("Only platform admins can see CRM analytics.");
    expect(text(r)).not.toContain("Forbidden resource");
    expect(r.root.findAllByType("table").length).toBe(1); // only the detail list; no totals
  });

  it("says the session ended when the server answers 401", async () => {
    install((path) => { if (path.startsWith("admin/crm/analytics?")) throw err(401, "UNAUTHORIZED", "x"); return standard(path); });
    const r = await mount();
    expect(text(r)).toContain("Your session has ended");
  });

  it("explains the range limit the server enforces", async () => {
    install((path) => { if (path.startsWith("admin/crm/analytics?")) throw err(400, "ADMIN_DATE_RANGE_TOO_LARGE", "The requested CRM analytics range cannot exceed 366 days."); return standard(path); });
    const r = await mount();
    expect(text(r)).toContain("Choose a range of 366 days or fewer.");
  });

  it("recovers on Try again after a network failure, without showing stale numbers meanwhile", async () => {
    let fail = true;
    install((path) => { if (path.startsWith("admin/crm/analytics?") && fail) throw new Error("offline"); return standard(path); });
    const r = await mount();
    expect(text(r)).toContain("Could not load CRM analytics.");
    expect(text(r)).not.toContain("By employee");
    expect(text(r)).not.toContain("Open follow-ups overdue");
    fail = false;
    await click(r, "Try again");
    expect(text(r)).not.toContain("Could not load CRM analytics.");
    expect(text(r)).toContain("By employee");
  });
});

describe("rows behind the numbers", () => {
  it("lists leads for the same period through the paged route, with contact and no notes", async () => {
    install(standard);
    const r = await mount();
    const q = query(pageCalls("leads")[0]);
    const a = query(analyticsCalls()[0]);
    expect(q.get("limit")).toBe("25");
    expect(q.get("from")).toBe(a.get("from"));
    expect(q.get("to")).toBe(a.get("to"));
    expect(q.has("cursor")).toBe(false);
    expect(q.has("status")).toBe(false);
    const t = text(r);
    expect(t).toContain("Shop 1");
    expect(t).toContain("+919000000001");
    expect(t).toContain("FQ-FE-00101");
    expect(t).toContain("Platform admins only. Contact details are shown.");
    expect(t).not.toMatch(/SECRET|Hidden Street/);
  });

  it("pages with the server's cursor and appends rows", async () => {
    install((path) => {
      if (path.startsWith("admin/crm/leads/page?")) {
        return query(path).get("cursor") === "cur-1" ? page([lead(3)], null) : page([lead(1), lead(2)], "cur-1");
      }
      return standard(path);
    });
    const r = await mount();
    expect(text(r)).toMatch(/2\s+shown\s*,\s*more available/);
    await click(r, "Show more");
    expect(query(pageCalls("leads").at(-1)).get("cursor")).toBe("cur-1");
    const t = text(r);
    expect(t).toContain("Shop 1");
    expect(t).toContain("Shop 3");
    expect(t).toMatch(/3\s+shown/);
    expect(t).not.toMatch(/more available/);
    expect(button(r, "Show more")).toBeUndefined();
  });

  it("restarts from the first page when the server says the cursor no longer fits", async () => {
    let first = true;
    install((path) => {
      if (path.startsWith("admin/crm/leads/page?")) {
        if (query(path).has("cursor")) throw err(400, "ADMIN_CURSOR_INVALID", "Cursor invalid");
        if (first) { first = false; return page([lead(1)], "cur-1"); }
        return page([lead(1), lead(2)], null);
      }
      return standard(path);
    });
    const r = await mount();
    await click(r, "Show more");
    await flush();
    const t = text(r);
    expect(t).toContain("reloaded from the start");
    expect(t).not.toContain("Cursor invalid");
    expect(t).toContain("Shop 2");
    expect(pageCalls("leads").filter((p) => !query(p).has("cursor"))).toHaveLength(2);
  });

  it("says paging is unavailable in plain words when the server cannot sign cursors", async () => {
    install((path) => { if (path.startsWith("admin/crm/leads/page?")) throw err(503, "ADMIN_CURSOR_UNAVAILABLE", "cursor signing secret missing"); return standard(path); });
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Paging is not available on the server right now.");
    expect(t).not.toContain("signing secret");
    expect(t).toContain("FQ-FE-00101"); // the totals above are unaffected
  });

  it("sends lead filters only after the admin pauses, and only values the server knows", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-detail-status", "ONBOARDED");
    await change(r, "crm-detail-source", "REFERRAL");
    await change(r, "crm-detail-search", "Raj");
    expect(pageCalls("leads")).toHaveLength(1);
    await wait(500);
    await flush();
    const q = query(pageCalls("leads").at(-1));
    expect(q.get("status")).toBe("ONBOARDED");
    expect(q.get("source")).toBe("REFERRAL");
    expect(q.get("q")).toBe("Raj");
  });

  it("does not search for a single character", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-detail-search", "R");
    await wait(500);
    await flush();
    expect(pageCalls("leads")).toHaveLength(1);
  });

  it("lists every row, not only the period, when the box is unticked", async () => {
    install(standard);
    const r = await mount();
    await act(async () => { byId(r, "crm-in-period").props.onChange({ target: { checked: false } }); });
    await flush();
    const q = query(pageCalls("leads").at(-1));
    expect(q.has("from")).toBe(false);
    expect(q.has("to")).toBe(false);
  });

  it("switches to visits and clears the lead filters that do not apply", async () => {
    install(standard);
    const r = await mount();
    await change(r, "crm-detail-status", "ONBOARDED");
    await wait(500);
    await click(r, "^Visits$");
    await wait(500);
    const q = query(pageCalls("visits").at(-1));
    expect(q.has("status")).toBe(false);
    expect(q.has("source")).toBe(false);
    const t = text(r);
    expect(t).toContain("Visit shop 1");
    expect(t).toContain("Demo Completed");
    expect(t).not.toContain("SECRET");
    await change(r, "crm-detail-outcome", "NOT_INTERESTED");
    await wait(500);
    await flush();
    expect(query(pageCalls("visits").at(-1)).get("outcome")).toBe("NOT_INTERESTED");
  });

  it("switches to follow-ups, marks an open one that is past due and sends status and channel", async () => {
    install(standard);
    const r = await mount();
    await click(r, "^Follow-ups$");
    const t = text(r);
    expect(t).toContain("Follow shop 1");
    expect(t).toContain("Overdue");
    expect(t).toContain("Completed");
    expect(t).not.toContain("SECRET");
    await change(r, "crm-detail-fstatus", "OPEN");
    await change(r, "crm-detail-channel", "WHATSAPP");
    await wait(500);
    await flush();
    const q = query(pageCalls("follow-ups").at(-1));
    expect(q.get("status")).toBe("OPEN");
    expect(q.get("channel")).toBe("WHATSAPP");
    expect(q.has("source")).toBe(false);
  });

  it("states an empty result plainly", async () => {
    install((path) => (path.startsWith("admin/crm/leads/page?") ? page([]) : standard(path)));
    const r = await mount();
    expect(text(r)).toContain("No rows match these filters.");
    expect(button(r, "Show more")).toBeUndefined();
  });

  it("links back to the CRM control center and platform operations", async () => {
    install(standard);
    const r = await mount();
    const hrefs = r.root.findAllByType("a").map((a) => a.props.href);
    expect(hrefs).toEqual(expect.arrayContaining(["/dashboard/admin/crm", "/dashboard/admin"]));
  });
});
