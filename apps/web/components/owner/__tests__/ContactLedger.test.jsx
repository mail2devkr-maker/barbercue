import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ContactListCheck } from "../ContactListCheck";
import { ContactLedgerPanel } from "../ContactLedgerPanel";
import { ContactsWorkspace } from "../ContactsWorkspace";
import { apiFetch, ApiError } from "../../../lib/api";
import { resetCapabilitiesCache } from "../../../lib/use-capabilities";

jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join(" ");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));

const SALON = "s1";
const BASE = `dashboard/salons/${SALON}/contacts`;
const gate = { dispatchEnabled: false, dispatchBlockedReason: "PROVIDER_AND_APPROVAL_GATES_REQUIRED", policyVersion: "test", retentionDays: 365 };

const preview = (statuses) => ({
  previewOnly: true,
  invitationEligibility: "NOT_EVALUATED",
  dispatchEnabled: false,
  dispatchBlockedReason: "CONSENT_SUPPRESSION_AND_PROVIDER_GATES_REQUIRED",
  summary: {
    total: statuses.length,
    validatedForReview: statuses.filter((s) => s === "VALIDATED_FOR_REVIEW").length,
    invalidPhone: statuses.filter((s) => s === "INVALID_PHONE").length,
    consentRequired: 0,
    consentEvidenceIncomplete: 0,
    consentTimestampInvalid: 0,
    duplicateInBatch: 0,
  },
  items: statuses.map((status, index) => ({ index, status })),
});
const saved = (outcomes) => ({
  ...gate,
  summary: {
    total: outcomes.length,
    recorded: outcomes.filter((o) => o === "RECORDED").length,
    alreadyRecorded: outcomes.filter((o) => o === "ALREADY_RECORDED").length,
    suppressed: outcomes.filter((o) => o === "SUPPRESSED").length,
    withdrawnByContact: outcomes.filter((o) => o === "WITHDRAWN_BY_CONTACT").length,
    rejected: outcomes.filter((o) => !["RECORDED", "ALREADY_RECORDED", "SUPPRESSED", "WITHDRAWN_BY_CONTACT"].includes(o)).length,
  },
  items: outcomes.map((outcome, index) => ({ index, outcome })),
});
const summaryBody = { ...gate, active: 4, withdrawn: 1, expired: 2, expiringWithin30Days: 3 };

let calls;
function install(routes) {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    const key = Object.keys(routes).find((k) => path === `${BASE}${k}` || path === k);
    if (!key) throw new Error(`unexpected request ${path}`);
    const handler = routes[key];
    const result = typeof handler === "function" ? handler(opts?.body ? JSON.parse(opts.body) : undefined) : handler;
    if (result instanceof Error) throw result;
    return result;
  });
}
const posted = (suffix) => calls.filter((c) => c.path === `${BASE}${suffix}` && c.opts?.method === "POST");

async function mountCheck(props = {}) {
  let r;
  await act(async () => { r = TestRenderer.create(<ContactListCheck salonId={SALON} {...props} />); });
  return r;
}
const type = async (r, value) => { await act(async () => { r.root.findByProps({ id: "contacts-text" }).props.onChange({ target: { value } }); }); };
const click = async (r, label) => { await act(async () => { button(r, label).props.onClick(); }); await flush(); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  resetCapabilitiesCache();
});

describe("ContactListCheck with the consent ledger", () => {
  const list = "90123 45678, IN_PERSON, 2026-09-30\n90123 45679, WRITTEN, 2026-09-30";

  it("offers nothing to save while the ledger is off, and keeps saying it is a check only", async () => {
    install({ "/preview": preview(["VALIDATED_FOR_REVIEW", "VALIDATED_FOR_REVIEW"]) });
    const r = await mountCheck();
    await type(r, list);
    await click(r, "Check list");
    const t = text(r);
    expect(t).toContain("check only");
    expect(t).not.toContain("Save agreement records");
    expect(posted("/consents")).toHaveLength(0);
  });

  it("saves exactly the list that was checked, shows one outcome per line without whole numbers, and says nobody was contacted", async () => {
    let savedBody;
    install({
      "/preview": preview(["VALIDATED_FOR_REVIEW", "VALIDATED_FOR_REVIEW"]),
      "/consents": (body) => { savedBody = body; return saved(["RECORDED", "ALREADY_RECORDED"]); },
    });
    const r = await mountCheck({ ledgerEnabled: true });
    await type(r, list);
    await click(r, "Check list");
    expect(text(r)).toContain("Save agreement records");
    expect(text(r)).toContain("saves nothing"); // the checking step itself still saves nothing

    const checkedBody = JSON.parse(calls.find((c) => c.path.endsWith("/preview")).opts.body);
    await click(r, "Save agreement records");
    expect(savedBody).toEqual(checkedBody); // the same request, not a re-built one
    const t = text(r);
    expect(t).toContain("1 saved, 1 already saved. Nobody was contacted.");
    expect(t).toContain("Saved");
    expect(t).toContain("Already saved");
    expect(t).toContain("••••5678");
    expect(t).not.toContain("90123 45678");
    expect(t).not.toContain("9012345678");
  });

  it("does not offer to save when no line looks complete", async () => {
    install({ "/preview": preview(["INVALID_PHONE"]) });
    const r = await mountCheck({ ledgerEnabled: true });
    await type(r, "abc");
    await click(r, "Check list");
    expect(text(r)).not.toContain("Save agreement records");
  });

  it("refuses to claim anything was saved when the answer does not match the list or says it could send", async () => {
    for (const bad of [saved(["RECORDED"]), { ...saved(["RECORDED", "RECORDED"]), dispatchEnabled: true }, null]) {
      install({ "/preview": preview(["VALIDATED_FOR_REVIEW", "VALIDATED_FOR_REVIEW"]), "/consents": bad });
      const r = await mountCheck({ ledgerEnabled: true });
      await type(r, list);
      await click(r, "Check list");
      await click(r, "Save agreement records");
      const t = text(r);
      expect(t).toContain("nothing is assumed to be saved");
      expect(t).not.toContain("Nobody was contacted.");
    }
  });

  it("explains a switched-off server and a rate limit in plain words", async () => {
    for (const [status, words] of [[503, "not switched on"], [429, "Wait a minute"]]) {
      install({ "/preview": preview(["VALIDATED_FOR_REVIEW"]), "/consents": new ApiError("x", status) });
      const r = await mountCheck({ ledgerEnabled: true });
      await type(r, "98765 43210, IN_PERSON, 2026-09-30");
      await click(r, "Check list");
      await click(r, "Save agreement records");
      expect(text(r)).toContain(words);
    }
  });
});

describe("ContactLedgerPanel", () => {
  async function mountPanel() {
    let r;
    await act(async () => { r = TestRenderer.create(<ContactLedgerPanel salonId={SALON} />); });
    await flush();
    return r;
  }
  const phone = async (r, value) => { await act(async () => { r.root.findByProps({ id: "ledger-phone" }).props.onChange({ target: { value } }); }); };
  const tick = async (r, id, checked) => { await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { checked } }); }); };

  it("shows counts only, and the retention period", async () => {
    install({ "/consents/summary": summaryBody });
    const t = text(await mountPanel());
    for (const label of ["Agreed", "Asked to stop", "Out of date", "Run out within 30 days"]) expect(t).toContain(label);
    expect(t).toMatch(/kept for\s+365\s+days/);
    expect(t).toContain("does not show saved numbers back");
  });

  it("records a stop request, optionally for the whole of FastQue, and clears the number afterwards", async () => {
    install({
      "/consents/summary": summaryBody,
      "/consents/withdraw": (body) => ({ withdrawn: true, suppressedEverywhere: body.suppressEverywhere }),
    });
    const r = await mountPanel();
    expect(button(r, "They asked to stop").props.disabled).toBe(true);
    await phone(r, "98765 43210");
    await tick(r, "ledger-everywhere", true);
    await click(r, "They asked to stop");
    expect(JSON.parse(posted("/consents/withdraw")[0].opts.body)).toEqual({ phone: "98765 43210", suppressEverywhere: true });
    expect(text(r)).toContain("added to the list nobody on FastQue may contact");
    expect(r.root.findByProps({ id: "ledger-phone" }).props.value).toBe("");
  });

  it("erases only after an explicit confirmation, keeps a do-not-contact marker unless told otherwise", async () => {
    install({
      "/consents/summary": summaryBody,
      "/consents/erase": (body) => ({ erased: 1, suppressionKept: body.keepSuppression }),
    });
    const r = await mountPanel();
    await phone(r, "98765 43210");
    expect(button(r, "Erase my record").props.disabled).toBe(true); // not confirmed yet
    await tick(r, "ledger-confirm", true);
    expect(button(r, "Erase my record").props.disabled).toBe(false);
    await click(r, "Erase my record");
    expect(JSON.parse(posted("/consents/erase")[0].opts.body)).toEqual({ phone: "98765 43210", keepSuppression: true });
    expect(text(r)).toContain("Only a do-not-contact marker is kept");

    await phone(r, "98765 43211");
    await tick(r, "ledger-confirm", true);
    await tick(r, "ledger-keep", false);
    await click(r, "Erase my record");
    expect(JSON.parse(posted("/consents/erase")[1].opts.body)).toEqual({ phone: "98765 43211", keepSuppression: false });
    expect(text(r)).toContain("erased completely");
  });

  it("explains an invalid number and a malformed answer without assuming anything changed", async () => {
    install({ "/consents/summary": summaryBody, "/consents/withdraw": new ApiError("x", 400) });
    const r = await mountPanel();
    await phone(r, "nope");
    await click(r, "They asked to stop");
    expect(text(r)).toContain("not a valid mobile number");

    install({ "/consents/summary": summaryBody, "/consents/erase": { erased: "many" } });
    const r2 = await mountPanel();
    await phone(r2, "98765 43210");
    await tick(r2, "ledger-confirm", true);
    await click(r2, "Erase my record");
    expect(text(r2)).toContain("nothing is assumed to be erased");
  });
});

describe("ContactsWorkspace", () => {
  const caps = (status, reasonCode = null) => ({ features: { contactImport: { status, reasonCode, updatedAt: null } } });
  async function mountWorkspace() {
    let r;
    await act(async () => { r = TestRenderer.create(<ContactsWorkspace salonId={SALON} />); });
    await flush();
    return r;
  }

  it("shows the agreement-record tools only when the server reports the ledger as switched on", async () => {
    install({ [`dashboard/salons/${SALON}/capabilities`]: caps("SANDBOX", "CONSENT_LEDGER_NO_DISPATCH"), "/consents/summary": summaryBody });
    const on = text(await mountWorkspace());
    expect(on).toContain("Saved agreement records");
    expect(on).toContain("Checking a list saves nothing");
  });

  it("stays exactly the old check-only page when the ledger is off or the server cannot say", async () => {
    install({ [`dashboard/salons/${SALON}/capabilities`]: caps("UNCONFIGURED", "CONTACT_IMPORT_PREVIEW_ONLY") });
    const off = text(await mountWorkspace());
    expect(off).not.toContain("Saved agreement records");
    expect(off).toContain("check only");
    expect(calls.some((c) => c.path.includes("/consents"))).toBe(false);

    resetCapabilitiesCache();
    install({ [`dashboard/salons/${SALON}/capabilities`]: new Error("offline") });
    const unknown = text(await mountWorkspace());
    expect(unknown).not.toContain("Saved agreement records");
    expect(unknown).toContain("check only");
  });
});
