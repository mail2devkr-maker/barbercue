import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ServiceFilterBar } from "../ServiceFilterBar";

const collect = (node) => (node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(collect).join("") : collect(node.children));
const text = (r) => collect(r.toJSON());
const categories = [
  { key: "beard", label: "Beard", count: 1 },
  { key: "hair", label: "Hair", count: 3 },
  { key: "", label: "Uncategorised", count: 2 },
];

function mount(props = {}) {
  const handlers = { onSearchChange: jest.fn(), onCategoryChange: jest.fn() };
  let r;
  act(() => {
    r = TestRenderer.create(
      <ServiceFilterBar categories={categories} visibleTotal={6} shownCount={6} search="" selectedCategory={null} {...handlers} {...props} />,
    );
  });
  return { r, ...handlers };
}
const chips = (r) => r.root.findAllByType("button").filter((b) => b.props["aria-pressed"] !== undefined);

describe("ServiceFilterBar", () => {
  it("shows a labelled search box and one chip per category with its count, plus All", () => {
    const { r } = mount();
    expect(r.root.findByProps({ id: "service-filter-search" }).props.type).toBe("search");
    expect(chips(r).map((c) => collect(c.props.children))).toEqual(["All (6)", "Beard (1)", "Hair (3)", "Uncategorised (2)"]);
    expect(text(r)).toContain("6 services");
  });

  it("marks the selected chip with aria-pressed", () => {
    const { r } = mount({ selectedCategory: "hair" });
    expect(chips(r).map((c) => c.props["aria-pressed"])).toEqual([false, false, true, false]);
  });

  it("selects a category, and clicking the selected one again returns to All", () => {
    const first = mount();
    act(() => { chips(first.r)[2].props.onClick(); });
    expect(first.onCategoryChange).toHaveBeenCalledWith("hair");
    const second = mount({ selectedCategory: "hair" });
    act(() => { chips(second.r)[2].props.onClick(); });
    expect(second.onCategoryChange).toHaveBeenCalledWith(null);
    act(() => { chips(second.r)[0].props.onClick(); });
    expect(second.onCategoryChange).toHaveBeenLastCalledWith(null);
  });

  it("reports typing in the search box", () => {
    const { r, onSearchChange } = mount();
    act(() => { r.root.findByProps({ id: "service-filter-search" }).props.onChange({ target: { value: "fade" } }); });
    expect(onSearchChange).toHaveBeenCalledWith("fade");
  });

  it("says how many are shown and offers Clear filters only while filtering", () => {
    const idle = mount();
    expect(text(idle.r)).not.toContain("Clear filters");
    const active = mount({ search: "fade", shownCount: 1 });
    expect(text(active.r)).toContain("Showing 1 of 6 services");
    const clear = active.r.root.findAllByType("button").find((b) => collect(b.props.children) === "Clear filters");
    act(() => { clear.props.onClick(); });
    expect(active.onSearchChange).toHaveBeenCalledWith("");
    expect(active.onCategoryChange).toHaveBeenCalledWith(null);
  });

  it("hides the chips when there is only one category (nothing to filter by) but keeps the search", () => {
    const { r } = mount({ categories: [{ key: "hair", label: "Hair", count: 6 }] });
    expect(chips(r)).toHaveLength(0);
    expect(r.root.findByProps({ id: "service-filter-search" })).toBeTruthy();
  });

  it("uses the singular for one service", () => {
    const { r } = mount({ visibleTotal: 1, shownCount: 1, categories: [] });
    expect(text(r)).toContain("1 service");
    expect(text(r)).not.toContain("1 services");
  });
});
