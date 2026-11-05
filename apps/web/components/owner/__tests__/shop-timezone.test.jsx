import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { useShopTimeZone } from "../OwnerShell";
import { formatShopTime } from "../format";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

it("useShopTimeZone is null (device-zone fallback) outside an owner shell and never throws", async () => {
  let seen = "unset";
  function Probe() {
    seen = useShopTimeZone();
    return null;
  }
  await act(async () => {
    TestRenderer.create(<Probe />);
  });
  expect(seen).toBeNull();
});

it("a shop time renders in the shop zone regardless of the device zone", () => {
  // 10:24 UTC is 3:54 pm in an Indian shop.
  expect(formatShopTime("2026-11-05T10:24:00.000Z", "Asia/Kolkata")).toBe(
    "3:54 pm",
  );
});
