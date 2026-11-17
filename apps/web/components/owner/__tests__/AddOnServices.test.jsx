import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { AddOnServices, visitServiceLabel } from "../AddOnServices";
import { apiFetch } from "../../../lib/api";

// Live-visit add-on mission (17 Nov 2026): the owner/barber adds a service the customer asked for at the shop.

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../../lib/idempotency", () => ({ newIdempotencyKey: () => "idem-1" }));

const services = [
  { id: "sv1", name: "Haircut", durationMinutes: 30, price: 250 },
  { id: "sv2", name: "Beard Trim", durationMinutes: 15, price: 150 },
  { id: "sv3", name: "Head Massage", durationMinutes: 20, price: 200 },
];

const entry = (over = {}) => ({
  id: "q1",
  salonId: "s1",
  status: "IN_SERVICE",
  serviceId: "sv1",
  serviceName: "Haircut",
  addOns: [],
  addOnMinutes: 0,
  ...over,
});

function textOf(node) {
  return node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}

function buttonWithText(root, text) {
  return root.find((n) => n.type === "button" && textOf(n).trim() === text);
}

describe("AddOnServices", () => {
  beforeEach(() => jest.clearAllMocks());

  it("offers only services not already on the visit and adds the chosen one", async () => {
    apiFetch.mockResolvedValue({});
    const onChanged = jest.fn();
    let r;
    await act(async () => {
      r = TestRenderer.create(
        <AddOnServices
          entry={entry({ addOns: [{ serviceId: "sv3", name: "Head Massage", durationMinutes: 20, price: 200, addedAt: "" }] })}
          services={services}
          onChanged={onChanged}
        />,
      );
    });
    await act(async () => buttonWithText(r.root, "Add service").props.onClick());
    const select = r.root.findByProps({ "aria-label": "Service to add" });
    const values = select.findAllByType("option").map((o) => o.props.value);
    expect(values).toEqual(["", "sv2"]);
    await act(async () => select.props.onChange({ target: { value: "sv2" } }));
    await act(async () => buttonWithText(r.root, "Add").props.onClick());
    expect(apiFetch).toHaveBeenCalledWith("dashboard/queue-entries/q1/add-ons", {
      method: "POST",
      headers: { "Idempotency-Key": "idem-1" },
      body: JSON.stringify({ serviceId: "sv2" }),
    });
    expect(onChanged).toHaveBeenCalledWith("Beard Trim added. Waiting times are updated.");
  });

  it("removes an add-on", async () => {
    apiFetch.mockResolvedValue({});
    const onChanged = jest.fn();
    let r;
    await act(async () => {
      r = TestRenderer.create(
        <AddOnServices
          entry={entry({ addOns: [{ serviceId: "sv2", name: "Beard Trim", durationMinutes: 15, price: 150, addedAt: "" }] })}
          services={services}
          onChanged={onChanged}
        />,
      );
    });
    await act(async () => r.root.findByProps({ "aria-label": "Remove Beard Trim" }).props.onClick());
    expect(apiFetch).toHaveBeenCalledWith("dashboard/queue-entries/q1/add-ons/sv2", { method: "DELETE" });
    expect(onChanged).toHaveBeenCalledWith("Beard Trim removed. Waiting times are updated.");
  });

  it("shows the server's reason when an add-on is refused", async () => {
    const { ApiError } = jest.requireMock("../../../lib/api");
    apiFetch.mockRejectedValueOnce(new ApiError("This service is already part of this visit."));
    let r;
    await act(async () => {
      r = TestRenderer.create(<AddOnServices entry={entry()} services={services} onChanged={jest.fn()} />);
    });
    await act(async () => buttonWithText(r.root, "Add service").props.onClick());
    await act(async () => r.root.findByProps({ "aria-label": "Service to add" }).props.onChange({ target: { value: "sv2" } }));
    await act(async () => buttonWithText(r.root, "Add").props.onClick());
    expect(r.root.findByProps({ role: "alert" }).props.children).toBe("This service is already part of this visit.");
  });

  it("disables adding when nothing is left to add", async () => {
    let r;
    await act(async () => {
      r = TestRenderer.create(<AddOnServices entry={entry()} services={[services[0]]} onChanged={jest.fn()} />);
    });
    expect(buttonWithText(r.root, "Add service").props.disabled).toBe(true);
  });

  it("names the whole visit", () => {
    expect(visitServiceLabel(entry())).toBe("Haircut");
    expect(visitServiceLabel(entry({ addOns: [{ serviceId: "sv2", name: "Beard Trim", durationMinutes: 15, price: 150, addedAt: "" }] }))).toBe(
      "Haircut + Beard Trim",
    );
    expect(visitServiceLabel(entry({ serviceName: null }))).toBeNull();
  });
});
