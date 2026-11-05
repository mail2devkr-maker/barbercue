import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { StaffHoursEditor } from "../StaffHoursEditor";
import { NotificationsPanel } from "../../owner/NotificationsPanel";
import { announceAssistantChange } from "../../../lib/assistant-events";
import { apiFetch } from "../../../lib/api";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
const refreshCounts = jest.fn();
jest.mock("../../owner/OwnerShell", () => ({
  useOwnerShell: () => ({ refreshCounts }),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("../../../lib/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1", roles: [] } }),
}));

// The web Jest environment is node: give the Assistant event bus a real EventTarget as `window`.
const hadWindow = "window" in globalThis;
beforeAll(() => {
  if (!hadWindow) globalThis.window = new EventTarget();
});
afterAll(() => {
  if (!hadWindow) delete globalThis.window;
});

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

/** After a confirmed Assistant change the open screen reloads from the API, never from the reply. */
it("Staff hours reload when the Assistant announces a staffHours change, and not for other resources", async () => {
  apiFetch.mockResolvedValue([]);
  let r;
  await act(async () => {
    r = TestRenderer.create(<StaffHoursEditor salonId="s1" staffId="t1" />);
  });
  await flush();
  expect(apiFetch).toHaveBeenCalledTimes(1);
  await act(async () => announceAssistantChange(["services"]));
  await flush();
  expect(apiFetch).toHaveBeenCalledTimes(1);
  await act(async () => announceAssistantChange(["staffHours"]));
  await flush();
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(apiFetch.mock.calls[1][0]).toContain("/staff/t1/");
  r.unmount();
});

it("Notifications reload and the sidebar badge refreshes after the Assistant marks all read", async () => {
  apiFetch.mockResolvedValue({ items: [], nextCursor: null });
  let r;
  await act(async () => {
    r = TestRenderer.create(<NotificationsPanel />);
  });
  await flush();
  const before = apiFetch.mock.calls.length;
  await act(async () => announceAssistantChange(["notifications"]));
  await flush();
  expect(apiFetch.mock.calls.length).toBe(before + 1);
  expect(apiFetch.mock.calls.at(-1)[0]).toBe("notifications/mine");
  expect(refreshCounts).toHaveBeenCalled();
  r.unmount();
});
