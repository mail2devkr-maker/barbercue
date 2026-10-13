import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import { RemoveAllServicesControl } from "../RemoveAllServicesControl";
import { apiFetch } from "../../../lib/api";

jest.mock("../../../lib/api", () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {},
}));

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  jest.clearAllMocks();
});

// JSX text and interpolated numbers are separate React children in the Node renderer.
function buttonText(button) {
  return Array.isArray(button.props.children)
    ? button.props.children.join("")
    : String(button.props.children);
}

it("requires typed intent and browser confirmation for all 180 services even when 0 active", async () => {
  let renderer;
  const priorWindow = globalThis.window;
  const confirm = jest.fn().mockReturnValue(false);
  globalThis.window = { confirm };
  const onRemoved = jest.fn().mockResolvedValue(undefined);
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <RemoveAllServicesControl
          basePath="dashboard/salons/shop-one/services"
          activeCount={0}
          totalCount={180}
          onRemoved={onRemoved}
        />
      );
    });
    expect(renderer.root.findAllByType("button").some((b) =>
      buttonText(b) === "Remove All Services (180)"
    )).toBe(true);
    const open = renderer.root.findAllByType("button").find((b) =>
      buttonText(b) === "Remove All Services (180)"
    );
    await act(async () => open.props.onClick());
    const dangerButton = () => renderer.root.findAllByType("button").find((b) =>
      b.props.children === "Confirm Permanent Delete (180)"
    );
    expect(dangerButton().props.disabled).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByProps({
      id: "confirm-remove-all-services",
    }).props.onChange({ target: { value: "DELETE ALL" } }));
    expect(dangerButton().props.disabled).toBe(false);
    await act(async () => dangerButton().props.onClick());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    apiFetch.mockResolvedValueOnce({ deletedCount: 180, remainingCount: 0 });
    await act(async () => dangerButton().props.onClick());
    expect(apiFetch).toHaveBeenCalledWith(
      "dashboard/salons/shop-one/services/delete-all",
      { method: "POST", body: JSON.stringify({
        confirmation: "DELETE ALL", expectedTotalCount: 180,
      }) },
    );
    expect(onRemoved).toHaveBeenCalledWith(180);
    // A replay click is blocked even before the page finishes navigating.
    expect(renderer.root.findAllByType("button").find((b) =>
      buttonText(b) === "Remove All Services (180)"
    ).props.disabled).toBe(true);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

it("disabled only when the shop has zero total services", async () => {
  let renderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(
        <RemoveAllServicesControl basePath="dashboard/salons/shop-two/services"
          activeCount={0} totalCount={0} onRemoved={async () => {}} />
      );
    });
    const removeButton = renderer.root.findAllByType("button").find((b) =>
      buttonText(b) === "Remove All Services (0)"
    );
    expect(removeButton.props.disabled).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
  }
});
