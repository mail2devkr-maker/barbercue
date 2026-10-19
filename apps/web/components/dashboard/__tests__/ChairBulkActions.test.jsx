import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { ChairStatus } from "@barbercue/shared";
import { ChairBulkActions, ChairSelectBox } from "../ChairBulkActions";
import { Button } from "../../ui/Button";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

const chairs = [
  { id: "c1", label: "Chair 1", status: ChairStatus.ACTIVE },
  { id: "c2", label: "Chair 2", status: ChairStatus.ACTIVE },
  { id: "c3", label: "Chair 3", status: ChairStatus.ACTIVE },
  { id: "c4", label: "Chair 4", status: ChairStatus.INACTIVE },
];
const ready = (id) => ({ chairId: id, label: `Chair ${id.slice(1)}`, status: "ACTIVE", expectedUpdatedAt: `v-${id}`, disposition: "READY", conflicts: [] });
const conflict = (id, ...conflicts) => ({ chairId: id, label: `Chair ${id.slice(1)}`, status: "ACTIVE", expectedUpdatedAt: `v-${id}`, disposition: "CONFLICT", conflicts });
// React splits interpolated text into separate nodes, so collect and join every text node.
const collect = (node) => (node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(collect).join("") : collect(node.children));
const text = (r) => collect(r.toJSON());
const buttonByTitle = (r, re) => r.root.findAllByType(Button).find((b) => re.test(String(b.props.children)));

let previews;
let applies;
let previewAnswer;
let applyAnswer;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  previews = [];
  applies = [];
  previewAnswer = (ids) => ids.map(ready);
  applyAnswer = (items) => items.map((i) => ({ chairId: i.chairId, label: `Chair ${i.chairId.slice(1)}`, result: "DEACTIVATED", conflicts: [] }));
  apiFetch.mockImplementation(async (path, opts) => {
    if (path.endsWith("/bulk-deactivate/preview")) {
      const body = JSON.parse(opts.body);
      previews.push(body);
      return { salonId: "s1", items: previewAnswer(body.chairIds) };
    }
    if (path.endsWith("/bulk-deactivate/apply")) {
      const body = JSON.parse(opts.body);
      applies.push(body);
      return { salonId: "s1", deactivatedCount: body.items.length, items: applyAnswer(body.items) };
    }
    return {};
  });
});

function mount(selectedIds = [], onSelectionChange = jest.fn(), onChanged = jest.fn()) {
  let r;
  act(() => {
    r = TestRenderer.create(
      <ChairBulkActions salonId="s1" chairs={chairs} selected={new Set(selectedIds)} onSelectionChange={onSelectionChange} onChanged={onChanged} />,
    );
  });
  return { r, onSelectionChange, onChanged };
}

describe("ChairSelectBox", () => {
  it("is labelled for assistive technology and absent for an already removed chair", () => {
    let a, b;
    act(() => { a = TestRenderer.create(<ChairSelectBox chair={chairs[0]} checked={false} onChange={() => {}} />); });
    expect(a.root.findByType("input").props["aria-label"]).toBe("Select Chair 1");
    act(() => { b = TestRenderer.create(<ChairSelectBox chair={chairs[3]} checked={false} onChange={() => {}} />); });
    expect(b.toJSON()).toBeNull();
  });
});

describe("ChairBulkActions", () => {
  it("counts only chairs that can still be removed and selects all of them", () => {
    const { r, onSelectionChange } = mount();
    expect(text(r)).toContain("Select all (3)");
    expect(text(r)).toContain("0 selected");
    act(() => { r.root.findAllByType("input")[0].props.onChange({ target: { checked: true } }); });
    expect([...onSelectionChange.mock.calls[0][0]].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("disables Review until something is selected", () => {
    expect(buttonByTitle(mount([]).r, /Review removal/).props.disabled).toBe(true);
    expect(buttonByTitle(mount(["c1"]).r, /Review removal/).props.disabled).toBe(false);
  });

  it("asks the server to review the selection and removes nothing until confirmed", async () => {
    previewAnswer = (ids) => ids.map((id) => (id === "c2" ? conflict(id, "ACTIVE_SERVICE_SESSION") : ready(id)));
    const { r } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    expect(previews).toEqual([{ chairIds: ["c1", "c2"] }]);
    const t = text(r);
    expect(t).toContain("Review removal of 2 chairs");
    expect(t).toContain("Cannot be removed now");
    expect(t).toContain("being served");
    expect(buttonByTitle(r, /Remove 1 chair/)).toBeTruthy();
    expect(applies).toHaveLength(0);
  });

  it("applies only the reviewed chairs with their reviewed version and reports every selected chair", async () => {
    previewAnswer = (ids) => ids.map((id) => (id === "c2" ? conflict(id, "ASSIGNED_QUEUE_ENTRY") : ready(id)));
    const { r, onChanged, onSelectionChange } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    await act(async () => { buttonByTitle(r, /Remove 1 chair/).props.onClick(); });
    expect(applies).toEqual([{ items: [{ chairId: "c1", expectedUpdatedAt: "v-c1" }] }]);
    const t = text(r);
    expect(t).toContain("1 removed");
    expect(t).toContain("1 not removed");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("shows a chair the server refused at apply time as not removed", async () => {
    applyAnswer = (items) => items.map((i) => ({ chairId: i.chairId, label: i.chairId, result: "CONFLICT", conflicts: ["STALE_PREVIEW"] }));
    const { r } = mount(["c1"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    await act(async () => { buttonByTitle(r, /Remove 1 chair/).props.onClick(); });
    expect(text(r)).toContain("0 removed");
    expect(text(r)).toContain("Review again");
  });

  it("warns that removing every chair leaves none in use", async () => {
    const { r } = mount(["c1", "c2", "c3"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    expect(text(r)).toContain("none of your chairs will be in use");
  });

  it("offers nothing and removes nothing when the server review fails", async () => {
    apiFetch.mockImplementation(async () => { throw new ApiError("Server unavailable"); });
    const { r } = mount(["c1"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    expect(text(r)).toContain("Server unavailable");
    expect(text(r)).not.toContain("Review removal of");
    expect(buttonByTitle(r, /Remove \d/)).toBeUndefined();
    expect(applies).toHaveLength(0);
  });

  it("cancelling the review changes nothing", async () => {
    const { r } = mount(["c1"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    act(() => { buttonByTitle(r, /Cancel/).props.onClick(); });
    expect(text(r)).not.toContain("Review removal of");
    expect(applies).toHaveLength(0);
  });

  it("reports a failed apply request without hiding it", async () => {
    apiFetch.mockImplementation(async (path, opts) => {
      if (path.endsWith("/preview")) return { salonId: "s1", items: JSON.parse(opts.body).chairIds.map(ready) };
      throw new ApiError("Server refused");
    });
    const { r } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    await act(async () => { buttonByTitle(r, /Remove 2 chairs/).props.onClick(); });
    const t = text(r);
    expect(t).toContain("2 failed");
    expect(t).toContain("Server refused");
  });
});
