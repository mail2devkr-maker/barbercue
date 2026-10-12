import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { apiFetch } from "../../../lib/api";
import { LiveQueueHistoryPanel } from "../LiveQueueHistoryPanel";
import { CustomerLiveQueueHistory } from "../../queue/CustomerLiveQueueHistory";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
jest.mock("../../booking/ReviewPanel", () => ({
  ReviewPanel: ({ title }) => <button>{title}</button>,
}));

function textOf(instance) {
  if (typeof instance === "string") return instance;
  return instance.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

let tree;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = undefined;
});

it("renders owner Live Queue history with preserved source and expired status labels", async () => {
  apiFetch.mockResolvedValueOnce({
    items: [
      {
        id: "LIVE_QUEUE:q-expired",
        source: "LIVE_QUEUE",
        bookingId: null,
        queueEntryId: "q-expired",
        salonId: "salon-1",
        salonName: "Handsome Center",
        salonTimezone: "Asia/Kolkata",
        currency: "INR",
        status: "EXPIRED",
        serviceDate: "2026-10-11T08:00:00.000Z",
        joinedAt: "2026-10-11T08:00:00.000Z",
        startedAt: null,
        completedAt: null,
        services: [
          {
            serviceId: "svc-1",
            name: "Haircut",
            assignedStaffName: null,
            price: null,
          },
        ],
        serviceName: "Haircut",
        assignedStaffName: null,
        price: null,
        review: null,
        reviewEligible: false,
        customerId: "customer-1",
        customerName: "Test Customer",
        customerPhone: "+910000000000",
        customerEmail: null,
        createdAt: "2026-10-11T08:00:00.000Z",
      },
    ],
    nextCursor: null,
  });

  await act(async () => {
    tree = TestRenderer.create(<LiveQueueHistoryPanel salonId="salon-1" />);
    await Promise.resolve();
  });

  const rendered = textOf(tree.root);
  expect(rendered).toContain("Live Queue Visits");
  expect(rendered).toContain("Live Queue");
  expect(rendered).toContain("Expired");
  expect(rendered).toContain("Haircut");
  expect(rendered).toContain("q-expire");
  expect(rendered).toContain("Not recorded");
  expect(rendered).not.toMatch(/walk[- _]?in/i);
});

it("renders an authenticated customer completed visit with the rating action", async () => {
  apiFetch.mockResolvedValueOnce({
    items: [
      {
        id: "LIVE_QUEUE:q-complete",
        source: "LIVE_QUEUE",
        bookingId: null,
        queueEntryId: "q-complete",
        salonId: "salon-1",
        salonName: "Handsome Center",
        salonTimezone: "Asia/Kolkata",
        currency: "INR",
        status: "COMPLETED",
        serviceDate: "2026-10-11T08:00:00.000Z",
        joinedAt: "2026-10-11T08:00:00.000Z",
        startedAt: "2026-10-11T08:20:00.000Z",
        completedAt: "2026-10-11T08:45:00.000Z",
        services: [
          {
            serviceId: "svc-1",
            name: "Haircut",
            assignedStaffName: null,
            price: null,
          },
        ],
        serviceName: "Haircut",
        assignedStaffName: null,
        price: null,
        review: null,
        reviewEligible: true,
        myReview: null,
      },
    ],
    nextCursor: null,
  });

  await act(async () => {
    tree = TestRenderer.create(<CustomerLiveQueueHistory />);
    await Promise.resolve();
  });

  const rendered = textOf(tree.root);
  expect(rendered).toContain("Live Queue visits");
  expect(rendered).toContain("Completed");
  expect(rendered).toContain("Source: Live Queue");
  expect(rendered).toContain("Rate your service");
  expect(apiFetch).toHaveBeenCalledWith(
    expect.stringContaining("source=LIVE_QUEUE"),
  );
  expect(rendered).not.toMatch(/walk[- _]?in/i);
});
