import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { DescriptionAssistant } from "../DescriptionAssistant";
import { ProfileSection } from "../ProfileSection";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../ui/Button", () => ({ Button: ({ children, ...props }) => <button {...props}>{children}</button> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400, code = "ERR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join("");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const button = (r, label) => r.root.findAllByType("button").find((b) => new RegExp(label).test(collect(b.props.children)));
const type = async (r, id, value) => { await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); }); };

const DRAFT = { draft: "Studio 360 is a friendly barbershop in Jharsuguda offering haircuts, beard trims and head massages for the whole family.", language: "en", persisted: false, requiresOwnerReview: true, notice: "Review every statement before you save it." };

let suggestionCalls;
function installSuggest(handler) {
  suggestionCalls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    suggestionCalls.push({ path, opts });
    return handler(opts);
  });
}

async function mount(onUse = jest.fn()) {
  let r;
  await act(async () => { r = TestRenderer.create(<DescriptionAssistant salonId="s1" onUse={onUse} />); });
  await act(async () => { button(r, "Write a draft with AI").props.onClick(); });
  return { r, onUse };
}
const generate = async (r) => { await act(async () => { button(r, "^Write a draft$").props.onClick(); }); await flush(); };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("DescriptionAssistant", () => {
  it("is optional and says the owner can always write their own description", async () => {
    installSuggest(() => DRAFT);
    let r;
    await act(async () => { r = TestRenderer.create(<DescriptionAssistant salonId="s1" onUse={() => {}} />); });
    expect(text(r)).toContain("You can always write your own description");
    expect(suggestionCalls).toHaveLength(0);
  });

  it("asks for a draft with language, tone and the owner's facts only", async () => {
    installSuggest(() => DRAFT);
    const { r } = await mount();
    await type(r, "draft-language", "hi");
    await type(r, "draft-tone", "friendly");
    await type(r, "draft-facts", "Open since 2012\nWedding packages");
    await generate(r);
    expect(suggestionCalls[0].path).toBe("dashboard/salons/s1/description/suggestions");
    expect(JSON.parse(suggestionCalls[0].opts.body)).toEqual({ language: "hi", tone: "friendly", ownerAttestedHighlights: ["Open since 2012", "Wedding packages"] });
  });

  it("shows an editable draft with the server's notice, and does not save or use it by itself", async () => {
    installSuggest(() => DRAFT);
    const { r, onUse } = await mount();
    await generate(r);
    expect(r.root.findByProps({ id: "draft-text" }).props.value).toBe(DRAFT.draft);
    expect(text(r)).toContain("Review every statement before you save it.");
    expect(text(r)).toContain("nothing is saved until you press Save profile");
    expect(onUse).not.toHaveBeenCalled();
    expect(suggestionCalls.every((c) => c.opts.method === "POST" && c.path.endsWith("/suggestions"))).toBe(true);
  });

  it("hands the (edited) draft to the description box only when the owner chooses to use it", async () => {
    installSuggest(() => DRAFT);
    const { r, onUse } = await mount();
    await generate(r);
    await type(r, "draft-text", "  My own edit of the draft.  ");
    await act(async () => { button(r, "Use this draft").props.onClick(); });
    expect(onUse).toHaveBeenCalledWith("My own edit of the draft.");
    expect(text(r)).toContain("Nothing has been saved yet");
  });

  it("refuses too many facts before sending", async () => {
    installSuggest(() => DRAFT);
    const { r } = await mount();
    await type(r, "draft-facts", "1\n2\n3\n4\n5\n6");
    await generate(r);
    expect(text(r)).toContain("at most 5");
    expect(suggestionCalls).toHaveLength(0);
  });

  it("says plainly that AI writing is not available while the provider is not configured, shows no draft, and never invents one", async () => {
    installSuggest(() => { throw new ApiError("Provider not configured", 503, "SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED"); });
    const { r, onUse } = await mount();
    await generate(r);
    expect(text(r)).toContain("not available yet");
    expect(text(r)).toContain("write your description yourself");
    expect(r.root.findAllByProps({ id: "draft-text" })).toHaveLength(0);
    expect(r.root.findAllByProps({ id: "draft-facts" })).toHaveLength(0); // nothing left to submit
    expect(onUse).not.toHaveBeenCalled();
  });

  it("explains a rate limit and a timeout, keeps the form, and invents no draft", async () => {
    installSuggest(() => { throw new ApiError("Too Many Requests", 429, "THROTTLED"); });
    const { r } = await mount();
    await generate(r);
    expect(text(r)).toContain("3 drafts every 10 minutes");
    installSuggest(() => { throw new ApiError("timeout", 504, "SALON_DESCRIPTION_PROVIDER_TIMEOUT"); });
    await generate(r);
    expect(text(r)).toContain("took too long");
    expect(r.root.findAllByProps({ id: "draft-text" })).toHaveLength(0);
  });

  it("does not treat an answer without a usable draft as a draft", async () => {
    installSuggest(() => ({ draft: "  " }));
    const { r } = await mount();
    await generate(r);
    expect(r.root.findAllByProps({ id: "draft-text" })).toHaveLength(0);
    expect(text(r)).toContain("could not be produced");
  });

  it("asks before a new draft replaces the owner's edits, and keeps the old draft if the new request fails", async () => {
    let n = 0;
    installSuggest(() => { n += 1; if (n === 1) return DRAFT; throw new ApiError("Bad gateway", 502, "SALON_DESCRIPTION_GENERATION_FAILED"); });
    const { r } = await mount();
    await generate(r);
    await type(r, "draft-text", "Edited by me");
    await act(async () => { button(r, "Write another draft").props.onClick(); });
    expect(text(r)).toContain("replaces your edits");
    expect(suggestionCalls).toHaveLength(1);
    await act(async () => { button(r, "Replace my edits").props.onClick(); });
    await flush();
    expect(suggestionCalls).toHaveLength(2);
    expect(text(r)).toContain("A draft could not be produced this time");
    expect(r.root.findByProps({ id: "draft-text" }).props.value).toBe("Edited by me");
  });

  it("regenerates without a prompt when the draft was not edited, and can discard", async () => {
    installSuggest(() => DRAFT);
    const { r } = await mount();
    await generate(r);
    await act(async () => { button(r, "Write another draft").props.onClick(); });
    await flush();
    expect(suggestionCalls).toHaveLength(2);
    await act(async () => { button(r, "Discard").props.onClick(); });
    expect(r.root.findAllByProps({ id: "draft-text" })).toHaveLength(0);
  });
});

describe("ProfileSection with the assistant", () => {
  const PROFILE = { name: "Studio 360", phone: "+919000000001", email: null, addressLine: "14 Station Road", postalCode: "768201", description: "Old text." };

  async function mountProfile(suggest) {
    const calls = [];
    apiFetch.mockImplementation(async (path, opts) => {
      calls.push({ path, opts });
      if (path.endsWith("/description/suggestions")) return suggest();
      if (opts?.method === "PATCH") return { ...PROFILE, ...JSON.parse(opts.body) };
      return PROFILE;
    });
    let r;
    await act(async () => { r = TestRenderer.create(<ProfileSection salonId="s1" />); });
    await flush();
    return { r, calls };
  }
  const descriptionBox = (r) => r.root.findAllByType("textarea").find((t) => t.props.rows === 3 && t.props.value !== undefined && !t.props.id);

  it("keeps the manual description box and Save profile fully working with no AI involved", async () => {
    const { r, calls } = await mountProfile(() => { throw new ApiError("n/a", 503, "SALON_DESCRIPTION_PROVIDER_NOT_CONFIGURED"); });
    await act(async () => { descriptionBox(r).props.onChange({ target: { value: "Written by hand." } }); });
    await act(async () => { button(r, "Save profile").props.onClick(); });
    await flush();
    const patch = calls.find((c) => c.opts?.method === "PATCH");
    expect(JSON.parse(patch.opts.body).description).toBe("Written by hand.");
    expect(calls.some((c) => c.path.endsWith("/description/suggestions"))).toBe(false);
  });

  it("puts a used draft in the description box and saves it only when the owner presses Save profile", async () => {
    const { r, calls } = await mountProfile(() => DRAFT);
    await act(async () => { button(r, "Write a draft with AI").props.onClick(); });
    await act(async () => { button(r, "^Write a draft$").props.onClick(); });
    await flush();
    await act(async () => { button(r, "Use this draft").props.onClick(); });
    expect(descriptionBox(r).props.value).toBe(DRAFT.draft);
    expect(calls.some((c) => c.opts?.method === "PATCH")).toBe(false); // nothing saved yet
    await act(async () => { button(r, "Save profile").props.onClick(); });
    await flush();
    expect(JSON.parse(calls.find((c) => c.opts?.method === "PATCH").opts.body).description).toBe(DRAFT.draft);
  });
});
