import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { PhotoReadinessCard } from "../PhotoReadinessCard";
import { apiFetch } from "../../../lib/api";

jest.mock("../../../lib/api", () => ({ apiFetch: jest.fn() }));

const collect = (node) => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collect).join("");
  return collect(node.children);
};
const text = (r) => collect(r.toJSON());
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function mount(photoCount = 2) {
  let r;
  await act(async () => { r = TestRenderer.create(<PhotoReadinessCard salonId="s1" photoCount={photoCount} />); });
  await flush();
  return r;
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

describe("PhotoReadinessCard", () => {
  it("reads the salon-scoped readiness route and shows the server's count", async () => {
    apiFetch.mockResolvedValue({ required: 3, current: 2, ready: false, grandfathered: false, reasons: ["THREE_VALID_PHOTOS_REQUIRED"] });
    const r = await mount();
    expect(apiFetch).toHaveBeenCalledWith("dashboard/salons/s1/photo-readiness");
    expect(text(r)).toContain("2 of 3 photos added");
    expect(text(r)).toContain("Add 1 more photo");
    const progress = r.root.findByType("progress");
    expect(progress.props.value).toBe(2);
    expect(progress.props.max).toBe(3);
  });

  it("shows a ready shop as ready", async () => {
    apiFetch.mockResolvedValue({ required: 3, current: 3, ready: true, grandfathered: false, reasons: [] });
    expect(text(await mount(3))).toContain("enough photos to open your shop");
  });

  it("tells an already-open shop the rule does not apply and shows no progress bar", async () => {
    apiFetch.mockResolvedValue({ required: 3, current: 1, ready: false, grandfathered: true, reasons: [] });
    const r = await mount(1);
    expect(text(r)).toContain("Your shop is already open");
    expect(r.root.findAllByType("progress")).toHaveLength(0);
  });

  it("shows nothing when the server cannot answer, rather than inventing a count", async () => {
    apiFetch.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    expect((await mount()).toJSON()).toBeNull();
  });

  it("shows nothing for an answer that is not the documented shape", async () => {
    apiFetch.mockResolvedValue({ current: "two" });
    expect((await mount()).toJSON()).toBeNull();
  });

  it("asks again when the number of photos on the page changes", async () => {
    apiFetch.mockResolvedValueOnce({ required: 3, current: 2, ready: false, grandfathered: false, reasons: [] }).mockResolvedValueOnce({ required: 3, current: 3, ready: true, grandfathered: false, reasons: [] });
    const r = await mount(2);
    await act(async () => { r.update(<PhotoReadinessCard salonId="s1" photoCount={3} />); });
    await flush();
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(text(r)).toContain("3 of 3 photos added");
  });
});
