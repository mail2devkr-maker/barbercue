import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CustomerFilterBar } from "../CustomerFilterBar";

const collect = (node) => (node == null || typeof node === "boolean" ? "" : typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(collect).join("") : collect(node.children));
const text = (r) => collect(r.toJSON());
const counts = { all: 12, new: 4, repeat: 5, frequent: 2, dues: 1 };

function mount(props = {}) {
  const h = { onSearchChange: jest.fn(), onSegmentChange: jest.fn(), onSortChange: jest.fn() };
  let r;
  act(() => {
    r = TestRenderer.create(
      <CustomerFilterBar search="" segment="all" counts={counts} sort="lastVisit" shown={12} loaded={12} {...h} {...props} />,
    );
  });
  return { r, ...h };
}
const chips = (r) => r.root.findAllByType("button").filter((b) => b.props["aria-pressed"] !== undefined);

describe("CustomerFilterBar", () => {
  it("labels the search box and sort control and lists every segment with its count", () => {
    const { r } = mount();
    expect(r.root.findByProps({ id: "customer-search" }).props.type).toBe("search");
    expect(r.root.findByProps({ id: "customer-sort" }).props.value).toBe("lastVisit");
    expect(chips(r).map((c) => collect(c.props.children))).toEqual(["All (12)", "New (4)", "Repeat (5)", "Frequent (2)", "Has dues (1)"]);
    expect(text(r)).toContain("12 customers loaded");
  });

  it("marks the selected segment with aria-pressed and reports a change", () => {
    const { r, onSegmentChange } = mount({ segment: "repeat" });
    expect(chips(r).map((c) => c.props["aria-pressed"])).toEqual([false, false, true, false, false]);
    act(() => { chips(r)[3].props.onClick(); });
    expect(onSegmentChange).toHaveBeenCalledWith("frequent");
  });

  it("reports typing and sort changes", () => {
    const { r, onSearchChange, onSortChange } = mount();
    act(() => { r.root.findByProps({ id: "customer-search" }).props.onChange({ target: { value: "98765" } }); });
    expect(onSearchChange).toHaveBeenCalledWith("98765");
    act(() => { r.root.findByProps({ id: "customer-sort" }).props.onChange({ target: { value: "mostVisits" } }); });
    expect(onSortChange).toHaveBeenCalledWith("mostVisits");
  });

  it("says how many of the loaded customers are shown and offers Clear filters only while filtering", () => {
    const idle = mount();
    expect(text(idle.r)).not.toContain("Clear filters");
    const active = mount({ search: "9876", shown: 2, loaded: 12 });
    expect(text(active.r)).toContain("Showing 2 of 12 loaded customers");
    const clear = active.r.root.findAllByType("button").find((b) => collect(b.props.children) === "Clear filters");
    act(() => { clear.props.onClick(); });
    expect(active.onSearchChange).toHaveBeenCalledWith("");
    expect(active.onSegmentChange).toHaveBeenCalledWith("all");
  });

  it("uses the singular for one customer", () => {
    const { r } = mount({ loaded: 1, shown: 1, counts: { ...counts, all: 1 } });
    expect(text(r)).toContain("1 customer loaded");
    expect(text(r)).not.toContain("1 customers");
  });
});
