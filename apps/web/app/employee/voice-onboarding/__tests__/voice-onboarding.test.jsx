import React from "react";
import { act, create } from "react-test-renderer";
import VoiceOnboardingPage from "../[leadId]/page";
import { apiFetch } from "../../../../lib/api";

global.IS_REACT_ACT_ENVIRONMENT = true;
global.self = global;

jest.mock("next/navigation", () => ({
  useParams: () => ({ leadId: "lead-a" }),
  useRouter: (() => {
    const router = { replace: jest.fn() };
    return () => router;
  })(),
}));
jest.mock("next/link", () => {
  const ReactRuntime = require("react");
  return ({ href, children, ...props }) =>
    ReactRuntime.createElement("a", { href, ...props }, children);
});
jest.mock("../../../../lib/auth-context", () => {
  const auth = {
    status: "authenticated",
    user: { email: "field@example.test", roles: ["FIELD_EXECUTIVE"] },
  };
  return { useAuth: () => auth };
});
jest.mock("../../../../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  apiFetch: jest.fn(),
}));

const employeeLog = {
  id: "log-a",
  leadId: "lead-a",
  transcript: "Ganesh Salon. Haircut 100 rupees.",
  language: "hi-IN",
  structuredDraft: {
    shopName: "Ganesh Salon",
    ownerName: null,
    mobile: null,
    address: null,
    city: null,
    locality: null,
    chairs: null,
    staffCount: null,
    services: [{ name: "Haircut", priceRupees: 100 }],
    notes: null,
  },
  status: "DRAFT",
  createdAt: "2026-10-13T10:00:00.000Z",
  updatedAt: "2026-10-13T10:00:00.000Z",
  confirmedAt: null,
  employee: { fullName: "Field Executive A", employeeCode: "FQ-FE-00101" },
};

function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("");
  if (value && typeof value === "object")
    return textOf(value.children ?? value.props?.children);
  return "";
}

function buttonWith(root, label) {
  return root.root
    .findAllByType("button")
    .find((button) => textOf(button.props.children).includes(label));
}

describe("employee voice onboarding mobile-first screen", () => {
  let renderer;
  let savedInput;

  beforeEach(() => {
    Object.defineProperty(global, "window", { configurable: true, value: {} });
    savedInput = null;
    apiFetch.mockImplementation(async (_url, options = {}) => {
      if (options.method === "POST") {
        savedInput = JSON.parse(options.body);
        return employeeLog;
      }
      if (options.method === "PATCH") {
        const body = JSON.parse(options.body);
        savedInput = body;
        return {
          ...employeeLog,
          ...body,
          status: body.status,
          confirmedAt:
            body.status === "CONFIRMED" ? employeeLog.updatedAt : null,
        };
      }
      return {
        lead: { id: "lead-a", shopName: "Ganesh Salon" },
        items: [],
        nextCursor: null,
      };
    });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it("offers a manual fallback, parses editable fields, saves a resumable draft, then requires review to confirm", async () => {
    await act(async () => {
      renderer = create(<VoiceOnboardingPage />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(textOf(renderer.toJSON())).toContain("Start voice onboarding");

    await act(async () => {
      buttonWith(renderer, "Start voice onboarding").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(textOf(renderer.toJSON())).toContain(
      "FastQue does not record or store raw audio",
    );
    expect(textOf(renderer.toJSON())).toContain("Manual typing available");
    const transcriptField = renderer.root.findByProps({
      "aria-label": "Original transcript",
    });
    await act(async () => {
      transcriptField.props.onChange({
        target: {
          value: "Ganesh Salon. Owner Rahul Kumar. Haircut 100 rupees.",
        },
      });
    });
    await act(async () => {
      buttonWith(renderer, "Extract fields from transcript").props.onClick();
    });
    expect(
      renderer.root.findAllByType("input").map((input) => input.props.value),
    ).toEqual(expect.arrayContaining(["Rahul Kumar", 100]));

    await act(async () => {
      buttonWith(renderer, "Save draft").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const postCall = apiFetch.mock.calls.find(
      ([, options]) => options?.method === "POST",
    );
    const createBody = JSON.parse(postCall[1].body);
    expect(createBody.submissionKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(createBody.structuredDraft.services[0]).toEqual({
      name: "Haircut",
      priceRupees: 100,
    });
    expect(textOf(renderer.toJSON())).toContain(
      "Draft saved. You can return to this lead and resume it later.",
    );
    expect(buttonWith(renderer, "Resume draft")).toBeTruthy();

    const checkbox = renderer.root
      .findAllByType("input")
      .find((input) => input.props.type === "checkbox");
    await act(async () => {
      checkbox.props.onChange({ target: { checked: true } });
    });
    await act(async () => {
      buttonWith(renderer, "Confirm and save visit").props.onClick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(savedInput?.status).toBe("CONFIRMED");
    expect(savedInput?.reviewAcknowledged).toBe(true);
    expect(textOf(renderer.toJSON())).toContain(
      "This does not publish services or prices to a live salon.",
    );
  }, 30_000);
});
