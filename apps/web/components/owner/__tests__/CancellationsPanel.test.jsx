import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { CancellationsPanel } from "../CancellationsPanel";
import { apiFetch, ApiError } from "../../../lib/api";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }) => <a href={href}>{children}</a>,
}));
jest.mock("../../../lib/api", () => {
  class MockApiError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.status = status;
    }
  }
  return { apiFetch: jest.fn(), ApiError: MockApiError };
});

function report(total, actor = "OWNER") {
  return {
    totalCancellations: total,
    totalBookings: 20,
    cancellationRatePercent: total * 5,
    currency: "INR",
    charges: { charged: 0, waived: 0, outstanding: 0 },
    liveQueue: { cancelled: 0, expired: 0, noShow: 0 },
    byActor: {
      CUSTOMER: actor === "CUSTOMER" ? total : 0,
      OWNER: actor === "OWNER" ? total : 0,
      STAFF: 0, SYSTEM: 0, ADMIN: 0, UNKNOWN: 0,
    },
    unattributedCount: 0,
    byService: [],
    byReason: [],
    rows: [],
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function firstKpi(renderer) {
  const values = renderer.root.findAll(
    (node) => node.type === "div" && typeof node.props.className === "string" &&
      node.props.className.split(" ").some((name) => name.includes("kpiValue")),
  );
  return values[0]?.children.join("");
}

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  apiFetch.mockReset();
});

describe("CancellationsPanel - owner issue #44", () => {
  it("keeps the newer owner-only totals when an older all-actor response arrives last", async () => {
    const initial = deferred();
    const filtered = deferred();
    apiFetch.mockReturnValueOnce(initial.promise).mockReturnValueOnce(filtered.promise);

    let view;
    await act(async () => { view = TestRenderer.create(<CancellationsPanel salonId="s1" />); });
    expect(apiFetch.mock.calls[0][0]).toContain("range=30d");
    expect(apiFetch.mock.calls[0][0]).not.toContain("&actor=");

    await act(async () => {
      view.root.findByProps({ id: "cx-actor" }).props.onChange({ target: { value: "OWNER" } });
    });
    expect(apiFetch.mock.calls[1][0]).toContain("actor=OWNER");

    await act(async () => { filtered.resolve(report(2)); });
    await flush();
    expect(firstKpi(view)).toBe("2");

    await act(async () => { initial.resolve(report(9, "CUSTOMER")); });
    await flush();
    expect(firstKpi(view)).toBe("2");
    expect(view.root.findByProps({ id: "cx-actor" }).props.value).toBe("OWNER");
  });

  it("does not show a stale error after the newer filtered request succeeded", async () => {
    const initial = deferred();
    const filtered = deferred();
    apiFetch.mockReturnValueOnce(initial.promise).mockReturnValueOnce(filtered.promise);

    let view;
    await act(async () => { view = TestRenderer.create(<CancellationsPanel salonId="s1" />); });
    await act(async () => {
      view.root.findByProps({ id: "cx-range" }).props.onChange({ target: { value: "7d" } });
    });
    await act(async () => { filtered.resolve(report(3)); });
    await flush();
    await act(async () => { initial.reject(new ApiError("Previous request failed")); });
    await flush();

    expect(firstKpi(view)).toBe("3");
    expect(JSON.stringify(view.toJSON())).not.toContain("Previous request failed");
  });

  it("clears an old error when changing the period, instead of masking the new loading state", async () => {
    const pending = deferred();
    apiFetch.mockRejectedValueOnce(new ApiError("Old network error")).mockReturnValueOnce(pending.promise);
    let view;
    await act(async () => { view = TestRenderer.create(<CancellationsPanel salonId="s1" />); });
    await flush();
    expect(JSON.stringify(view.toJSON())).toContain("Old network error");
    await act(async () => {
      view.root.findByProps({ id: "cx-range" }).props.onChange({ target: { value: "90d" } });
    });
    expect(JSON.stringify(view.toJSON())).not.toContain("Old network error");
    await act(async () => { pending.resolve(report(0)); });
    await flush();
    expect(firstKpi(view)).toBe("0");
  });
});
