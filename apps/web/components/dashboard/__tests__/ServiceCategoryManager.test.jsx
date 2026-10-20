import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ServiceCategoryManager } from "../ServiceCategoryManager";
import { ServiceTaxonomyPicker } from "../ServiceTaxonomyPicker";
import { apiFetch, ApiError } from "../../../lib/api";
import { EMPTY_CHOICE, NEW_NODE } from "../../../lib/service-taxonomy";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
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
const button = (r, label) => r.root.findAllByType("button").find((b) => (label instanceof RegExp ? label : new RegExp(label)).test(collect(b.props.children)));

let tree;
let services;
let calls;
let failWith;
function install() {
  calls = [];
  apiFetch.mockImplementation(async (path, opts) => {
    calls.push({ path, opts });
    if (opts?.method) {
      if (failWith) throw failWith;
      return {};
    }
    if (path.endsWith("/service-categories")) {
      if (tree === "missing") throw new ApiError(404, { error: { code: "NOT_FOUND", message: "Cannot GET" } });
      return tree;
    }
    if (path.endsWith("/services")) return services;
    throw new Error(`unexpected ${path}`);
  });
}
async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<ServiceCategoryManager salonId="s1" />); });
  await flush();
  await flush();
  return r;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  failWith = null;
  tree = [
    { id: "c-hair", name: "Hair", subcategories: [{ id: "s-cut", name: "Cut" }] },
    { id: "c-skin", name: "Skin", subcategories: [] },
  ];
  services = [
    { id: "v1", name: "Haircut", category: "Hair", subcategory: "Cut", categoryId: "c-hair", subcategoryId: "s-cut", isActive: true },
    { id: "v2", name: "Facial", category: "Skin", subcategory: null, categoryId: "c-skin", subcategoryId: null, isActive: true },
  ];
});

describe("ServiceCategoryManager", () => {
  it("shows the tree with how many services are in each node", async () => {
    install();
    const r = await mount();
    const t = text(r);
    expect(t).toContain("Hair");
    expect(t).toContain("Cut");
    expect(t).toMatch(/1\s+service/);
    expect(r.root.findAll((n) => n.props?.href === "/dashboard/salons/s1/services").length).toBeGreaterThan(0);
  });

  it("says plainly when the server has no category routes", async () => {
    tree = "missing";
    install();
    const r = await mount();
    expect(text(r)).toContain("not available yet");
    expect(text(r)).not.toContain("Cannot GET");
  });

  it("adds a category by name and reloads the tree", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "new-category" }).props.onChange({ target: { value: "  Nails " } }); });
    await act(async () => { r.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }); });
    await flush();
    const post = calls.find((c) => c.opts?.method === "POST");
    expect(post.path).toBe("dashboard/salons/s1/service-categories");
    expect(JSON.parse(post.opts.body)).toEqual({ name: "Nails" });
    expect(text(r)).toContain("Nails added.");
    expect(calls.filter((c) => !c.opts && c.path.endsWith("/service-categories")).length).toBeGreaterThanOrEqual(2);
  });

  it("does not add a name that already exists, nor an empty one", async () => {
    install();
    const r = await mount();
    await act(async () => { r.root.findByProps({ id: "new-category" }).props.onChange({ target: { value: " hair " } }); });
    await act(async () => { r.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }); });
    expect(text(r)).toContain("already have a category called");
    await act(async () => { r.root.findByProps({ id: "new-category" }).props.onChange({ target: { value: "   " } }); });
    await act(async () => { r.root.findAllByType("form")[0].props.onSubmit({ preventDefault() {} }); });
    expect(text(r)).toContain("Enter a name");
    expect(calls.some((c) => c.opts?.method)).toBe(false);
  });

  it("renames a subcategory under its category", async () => {
    install();
    const r = await mount();
    const subRow = r.root.findAllByType("li").find((li) => /Cut/.test(collect(li.children)) && li.findAllByType("button").some((b) => /Rename/.test(collect(b.props.children))) && !/Haircut/.test(collect(li.children).slice(0, 4)));
    const renameButtons = r.root.findAllByType("button").filter((b) => /Rename/.test(collect(b.props.children)));
    // Rename buttons are in document order: Hair, Cut, Skin
    await act(async () => { renameButtons[1].props.onClick(); });
    await act(async () => { r.root.findByProps({ "aria-label": "New name for Cut" }).props.onChange({ target: { value: "Trim" } }); });
    await act(async () => { r.root.findByProps({ "aria-label": "New name for Cut" }).parent.props.onSubmit({ preventDefault() {} }); });
    await flush();
    const patch = calls.find((c) => c.opts?.method === "PATCH");
    expect(patch.path).toBe("dashboard/salons/s1/service-categories/c-hair/subcategories/s-cut");
    expect(JSON.parse(patch.opts.body)).toEqual({ name: "Trim" });
    expect(subRow).toBeDefined();
  });

  it("warns before deleting a category that still has services, and shows the server's refusal", async () => {
    install();
    failWith = new ApiError(409, { error: { code: "SERVICE_TAXONOMY_IN_USE", message: "x" } });
    const r = await mount();
    const del = r.root.findAllByType("button").filter((b) => /^\s*Delete\s*$/.test(collect(b.props.children)))[0];
    await act(async () => { del.props.onClick(); });
    expect(text(r)).toMatch(/still has 1\s+service/);
    await act(async () => { button(r, /Delete\s+Hair/).props.onClick(); });
    await flush();
    expect(calls.find((c) => c.opts?.method === "DELETE").path).toBe("dashboard/salons/s1/service-categories/c-hair");
    expect(text(r)).toContain("Move or remove");
  });

  it("deletes an empty category after confirmation", async () => {
    install();
    const r = await mount();
    const dels = r.root.findAllByType("button").filter((b) => /^\s*Delete\s*$/.test(collect(b.props.children)));
    // Delete buttons in order: Hair, Cut, Skin. Skin has a service here, so make it empty first.
    services = [services[0]];
    await act(async () => { dels[2].props.onClick(); });
    await act(async () => { button(r, /Delete\s+Skin/).props.onClick(); });
    await flush();
    expect(calls.find((c) => c.opts?.method === "DELETE").path).toBe("dashboard/salons/s1/service-categories/c-skin");
  });
});

describe("ServiceTaxonomyPicker", () => {
  const T = [{ id: "c-hair", name: "Hair", subcategories: [{ id: "s-cut", name: "Cut" }] }];
  function render(value, tree = T) {
    const onChange = jest.fn();
    let r;
    act(() => { r = TestRenderer.create(<ServiceTaxonomyPicker tree={tree} value={value} onChange={onChange} idPrefix="t" />); });
    return { r, onChange };
  }

  it("falls back to the plain text box without a tree", () => {
    const { r, onChange } = render({ ...EMPTY_CHOICE, newCategory: "Old" }, null);
    expect(r.root.findByProps({ id: "t-category" }).props.value).toBe("Old");
    act(() => { r.root.findByProps({ id: "t-category" }).props.onChange({ target: { value: "New" } }); });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_CHOICE, newCategory: "New" });
  });

  it("offers existing categories and a new one, and shows subcategories under the chosen category", () => {
    const { r, onChange } = render({ ...EMPTY_CHOICE, categoryId: "c-hair" });
    const options = r.root.findByProps({ id: "t-category" }).findAllByType("option").map((o) => collect(o.props.children));
    expect(options).toEqual(["No category", "Hair", "A new category…"]);
    const sub = r.root.findByProps({ id: "t-subcategory" }).findAllByType("option").map((o) => collect(o.props.children));
    expect(sub).toEqual(["No subcategory", "Cut", "A new subcategory…"]);
    act(() => { r.root.findByProps({ id: "t-category" }).props.onChange({ target: { value: NEW_NODE } }); });
    expect(onChange).toHaveBeenCalledWith({ categoryId: NEW_NODE, newCategory: "", subcategoryId: "", newSubcategory: "" });
  });

  it("clears the subcategory when another category is chosen", () => {
    const tree2 = [...T, { id: "c-skin", name: "Skin", subcategories: [] }];
    const { r, onChange } = render({ ...EMPTY_CHOICE, categoryId: "c-hair", subcategoryId: "s-cut" }, tree2);
    act(() => { r.root.findByProps({ id: "t-category" }).props.onChange({ target: { value: "c-skin" } }); });
    expect(onChange).toHaveBeenCalledWith({ categoryId: "c-skin", newCategory: "", subcategoryId: "", newSubcategory: "" });
  });

  it("tells the owner when a new name already exists", () => {
    const { r } = render({ ...EMPTY_CHOICE, categoryId: NEW_NODE, newCategory: " hair " });
    expect(collect(r.toJSON())).toContain("that one will be used");
  });

  it("hides the subcategory until there is a category", () => {
    const { r } = render(EMPTY_CHOICE);
    expect(r.root.findAllByProps({ id: "t-subcategory" })).toHaveLength(0);
  });
});
