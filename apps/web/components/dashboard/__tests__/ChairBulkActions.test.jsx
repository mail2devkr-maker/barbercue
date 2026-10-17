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
const free = (id) => ({ id, label: id, occupancy: "FREE", manualOccupancyId: null, activeServiceSessionId: null, tokenNumber: null, reservedForEntryId: null, reservedForTokenNumber: null });
// React splits interpolated text into separate nodes, so collect and join every text node.
const collect = (node) => (node == null ? "" : typeof node === "string" ? node : Array.isArray(node) ? node.map(collect).join("") : collect(node.children));
const text = (r) => collect(r.toJSON());
const buttonByTitle = (r, re) => r.root.findAllByType(Button).find((b) => re.test(String(b.props.children)));

let patches;
let board;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
  patches = [];
  board = [free("c1"), free("c2"), free("c3")];
  apiFetch.mockImplementation(async (path, opts) => {
    if (opts?.method === "PATCH") { patches.push({ path, body: JSON.parse(opts.body) }); return { id: path.split("/").pop(), status: "INACTIVE" }; }
    if (path.endsWith("/queue")) return { chairs: board };
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
    const selectAll = r.root.findAllByType("input")[0];
    act(() => { selectAll.props.onChange({ target: { checked: true } }); });
    expect([...onSelectionChange.mock.calls[0][0]].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("disables Review until something is selected", () => {
    const none = mount([]);
    expect(buttonByTitle(none.r, /Review removal/).props.disabled).toBe(true);
    const some = mount(["c1"]);
    expect(buttonByTitle(some.r, /Review removal/).props.disabled).toBe(false);
  });

  it("shows a conflict preview, blocks a chair in service, and sends NO request until confirmed", async () => {
    board = [free("c1"), { ...free("c2"), occupancy: "FASTQUE", activeServiceSessionId: "s1", tokenNumber: 9 }, free("c3")];
    const { r } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    const t = text(r);
    expect(t).toContain("Review removal of 2 chairs");
    expect(t).toContain("Cannot be removed now");
    expect(t).toContain("#9");
    expect(buttonByTitle(r, /Remove 1 chair/)).toBeTruthy();
    expect(patches).toHaveLength(0);
  });

  it("removes only the removable chairs on confirmation and reports every selected chair", async () => {
    board = [free("c1"), { ...free("c2"), occupancy: "FASTQUE", activeServiceSessionId: "s1", tokenNumber: 9 }, free("c3")];
    const { r, onChanged, onSelectionChange } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    await act(async () => { buttonByTitle(r, /Remove 1 chair/).props.onClick(); });
    expect(patches.map((p) => p.path)).toEqual(["dashboard/salons/s1/chairs/c1"]);
    expect(patches[0].body).toEqual({ status: ChairStatus.INACTIVE });
    const t = text(r);
    expect(t).toContain("1 removed");
    expect(t).toContain("1 not removed");
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("warns that removing every chair leaves none in use", async () => {
    const { r } = mount(["c1", "c2", "c3"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    expect(text(r)).toContain("none of your chairs will be in use");
  });

  it("refuses to remove anything when the live queue cannot be read", async () => {
    apiFetch.mockImplementation(async (path) => { if (path.endsWith("/queue")) throw new Error("offline"); return {}; });
    const { r } = mount(["c1"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    expect(text(r)).toContain("Cannot be removed now");
    expect(buttonByTitle(r, /Remove 0 chairs/).props.disabled).toBe(true);
    expect(patches).toHaveLength(0);
  });

  it("cancelling the review changes nothing", async () => {
    const { r } = mount(["c1"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    act(() => { buttonByTitle(r, /Cancel/).props.onClick(); });
    expect(text(r)).not.toContain("Review removal of");
    expect(patches).toHaveLength(0);
  });

  it("reports a server failure for one chair without hiding it", async () => {
    apiFetch.mockImplementation(async (path, opts) => {
      if (opts?.method === "PATCH") { if (path.endsWith("/c2")) throw new ApiError("Server refused"); patches.push(path); return {}; }
      if (path.endsWith("/queue")) return { chairs: board };
      return {};
    });
    const { r } = mount(["c1", "c2"]);
    await act(async () => { buttonByTitle(r, /Review removal/).props.onClick(); });
    await act(async () => { buttonByTitle(r, /Remove 2 chairs/).props.onClick(); });
    const t = text(r);
    expect(t).toContain("1 removed");
    expect(t).toContain("1 failed");
  });
});
