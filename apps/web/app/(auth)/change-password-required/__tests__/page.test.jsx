import React, { act } from "react";
import TestRenderer from "react-test-renderer";
import ChangePasswordRequiredPage from "../page";
import { apiFetch, setAccessToken } from "../../../../lib/api";

jest.mock("next/link", () => ({ __esModule: true, default: ({ children, href, ...rest }) => <a href={href} {...rest}>{children}</a> }));
jest.mock("../../../../components/auth/AuthCard", () => ({
  AuthCard: ({ title, subtitle, children }) => <div><h1>{title}</h1><p>{subtitle}</p>{children}</div>,
}));
jest.mock("../../../../lib/api", () => ({
  apiFetch: jest.fn(),
  setAccessToken: jest.fn(),
  ApiError: class ApiError extends Error {},
}));
const { ApiError } = jest.requireMock("../../../../lib/api");

const collect = (n) => (n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(collect).join(" ") : collect(n.children));
const text = (r) => collect(r.toJSON());
const byId = (r, id) => r.root.find((n) => typeof n.type === "string" && n.props.id === id);
const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const type = async (r, id, value) => { await act(async () => { byId(r, id).props.onChange({ target: { value } }); }); };
const submit = async (r) => { await act(async () => { await r.root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); };
async function mount() {
  let r;
  await act(async () => { r = TestRenderer.create(<ChangePasswordRequiredPage />); });
  return r;
}
async function fill(r, current, next, confirm) {
  await type(r, "temporary-password", current);
  await type(r, "new-password", next);
  await type(r, "confirm-password", confirm);
}
beforeEach(() => { globalThis.IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); });

describe("mandatory password change page", () => {
  it("explains why and refuses bad input before calling the server", async () => {
    const r = await mount();
    expect(text(r)).toContain("temporary password");
    await fill(r, "", "Brand-new-Passw0rd", "Brand-new-Passw0rd");
    await submit(r);
    expect(text(r)).toContain("Enter the temporary password");
    await fill(r, "Temp-Passw0rd-1", "short", "short");
    await submit(r);
    expect(text(r)).toContain("8 to 72 characters");
    await fill(r, "Temp-Passw0rd-1", "Temp-Passw0rd-1", "Temp-Passw0rd-1");
    await submit(r);
    expect(text(r)).toContain("different from the temporary one");
    await fill(r, "Temp-Passw0rd-1", "Brand-new-Passw0rd", "Other-Passw0rd-2");
    await submit(r);
    expect(text(r)).toContain("do not match");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("sends the change, forgets the passwords, drops the in-memory token and sends the person to sign in again", async () => {
    apiFetch.mockResolvedValue({ success: true });
    const r = await mount();
    await fill(r, "Temp-Passw0rd-1", "Brand-new-Passw0rd", "Brand-new-Passw0rd");
    await submit(r);
    expect(apiFetch).toHaveBeenCalledWith("auth/password/change-required", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ currentPassword: "Temp-Passw0rd-1", newPassword: "Brand-new-Passw0rd" });
    expect(setAccessToken).toHaveBeenCalledWith(null);
    expect(text(r)).toContain("Password changed");
    expect(r.root.findAll((n) => n.type === "a" && n.props.href === "/owner/login")).toHaveLength(1);
    const dump = JSON.stringify(r.toJSON());
    expect(dump).not.toContain("Temp-Passw0rd-1");
    expect(dump).not.toContain("Brand-new-Passw0rd");
  });

  it("shows the server's reason (wrong or expired temporary password) and keeps the form", async () => {
    apiFetch.mockRejectedValue(new ApiError("The temporary password has expired. Ask FastQue to issue a new one."));
    const r = await mount();
    await fill(r, "Temp-Passw0rd-1", "Brand-new-Passw0rd", "Brand-new-Passw0rd");
    await submit(r);
    expect(text(r)).toContain("temporary password has expired");
    expect(text(r)).not.toContain("Password changed");
    expect(setAccessToken).not.toHaveBeenCalled();
  });
});
