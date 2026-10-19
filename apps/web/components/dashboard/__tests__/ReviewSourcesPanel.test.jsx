import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ExternalSourceView, ReviewProfileLinks, ReviewSourceTabs } from "../ReviewSourcesPanel";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../ui/Button", () => ({ Button: ({ children, variant, ...props }) => <button {...props}>{children}</button> }));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(status, body) {
      super(body?.error?.message ?? "Request failed");
      this.status = status;
      this.code = body?.error?.code ?? "UNKNOWN_ERROR";
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

const SOURCES = [
  { source: "FASTQUE", state: "CONNECTED", profileUrl: null },
  { source: "GOOGLE", state: "LINK_ONLY", profileUrl: "https://g.page/example" },
  { source: "FACEBOOK", state: "UNAVAILABLE", profileUrl: null },
  { source: "INSTAGRAM", state: "UNAVAILABLE", profileUrl: null },
];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("ReviewSourceTabs", () => {
  it("shows FastQue and the three outside sources with their state, and switches", () => {
    const onChange = jest.fn();
    let r;
    act(() => { r = TestRenderer.create(<ReviewSourceTabs sources={SOURCES} value="FASTQUE" onChange={onChange} />); });
    const t = text(r);
    expect(t).toContain("FastQue");
    expect(t).toContain("Google");
    expect(t).toContain("Link only");
    expect(t).toContain("No link added");
    const tabs = r.root.findAllByProps({ role: "tab" }).filter((n) => n.type === "button");
    expect(tabs).toHaveLength(4);
    expect(tabs[0].props["aria-selected"]).toBe(true);
    act(() => { tabs[1].props.onClick(); });
    expect(onChange).toHaveBeenCalledWith("GOOGLE");
  });
});

describe("ExternalSourceView", () => {
  it("links out safely when a link was added and never shows reviews", () => {
    let r;
    act(() => { r = TestRenderer.create(<ExternalSourceView source="GOOGLE" sources={SOURCES} />); });
    const link = r.root.findByType("a");
    expect(link.props.href).toBe("https://g.page/example");
    expect(link.props.target).toBe("_blank");
    expect(link.props.rel).toContain("noopener");
    expect(text(r)).toContain("does not fetch, count or show reviews");
  });
  it("says there is no link yet", () => {
    let r;
    act(() => { r = TestRenderer.create(<ExternalSourceView source="FACEBOOK" sources={SOURCES} />); });
    expect(r.root.findAllByType("a")).toHaveLength(0);
    expect(text(r)).toContain("have not added");
  });
});

describe("ReviewProfileLinks", () => {
  async function mount(sources = SOURCES, onSaved = jest.fn()) {
    let r;
    await act(async () => { r = TestRenderer.create(<ReviewProfileLinks salonId="s1" sources={sources} onSaved={onSaved} />); });
    await flush();
    return { r, onSaved };
  }
  const type = async (r, id, value) => { await act(async () => { r.root.findByProps({ id }).props.onChange({ target: { value } }); }); };
  const submit = async (r) => { await act(async () => { r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); };

  it("fills the boxes from the saved links and says nothing is read from those sites", async () => {
    const { r } = await mount();
    expect(r.root.findByProps({ id: "profile-googleUrl" }).props.value).toBe("https://g.page/example");
    expect(r.root.findByProps({ id: "profile-facebookUrl" }).props.value).toBe("");
    expect(text(r)).toContain("does not read or count reviews");
  });

  it("sends only the changed link with PUT, and clears one with null", async () => {
    apiFetch.mockResolvedValue({ sources: [...SOURCES.slice(0, 1), { source: "GOOGLE", state: "UNAVAILABLE", profileUrl: null }, { source: "FACEBOOK", state: "LINK_ONLY", profileUrl: "https://www.facebook.com/shop" }, SOURCES[3]] });
    const { r, onSaved } = await mount();
    await type(r, "profile-googleUrl", "");
    await type(r, "profile-facebookUrl", "https://www.facebook.com/shop");
    await submit(r);
    const [path, opts] = apiFetch.mock.calls[0];
    expect(path).toBe("dashboard/salons/s1/review-profiles");
    expect(opts.method).toBe("PUT");
    expect(JSON.parse(opts.body)).toEqual({ googleUrl: null, facebookUrl: "https://www.facebook.com/shop" });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(text(r)).toContain("Links saved.");
  });

  it("sends nothing for an invalid link and says which box", async () => {
    const { r } = await mount();
    await type(r, "profile-instagramUrl", "https://evil.example/x");
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toContain("not a Instagram page link");
  });

  it("sends nothing when nothing changed", async () => {
    const { r } = await mount();
    await submit(r);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(text(r)).toContain("Nothing changed");
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    apiFetch.mockRejectedValue(new ApiError(400, { error: { code: "VALIDATION_ERROR", message: "x" } }));
    const { r } = await mount();
    await type(r, "profile-facebookUrl", "https://www.facebook.com/shop");
    await submit(r);
    expect(text(r)).toContain("A link was not accepted");
    expect(r.root.findByProps({ id: "profile-facebookUrl" }).props.value).toBe("https://www.facebook.com/shop");
  });
});
