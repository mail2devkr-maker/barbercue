import { Role } from "@barbercue/shared";
import RegisterGate from "../RegisterGate";
import { ApiError } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { mount, text } from "../../../lib/hr-register/__tests__/helpers";

jest.mock("../../../lib/auth-context", () => ({ useAuth: jest.fn() }));

const apiError = (status, code = "X") => new ApiError(status, { error: { code, message: "m" } });
const asUser = (roles, status = "authenticated") => useAuth.mockReturnValue({ status, user: roles ? { roles } : null });
const apiWith = (probe) => ({ probe: jest.fn(probe) });

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAuth.mockReset();
});

describe("RegisterGate", () => {
  test.each([Role.HR_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_ADMIN])("%s reaches the register once the backend answers", async (role) => {
    asUser([role]);
    const api = apiWith(async () => undefined);
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(api.probe).toHaveBeenCalledTimes(1);
    expect(text(r)).toContain("REGISTER-CONTENT");
  });

  test.each([[Role.SALES_ADMIN], [Role.PLATFORM_VIEWER], [Role.CUSTOMER], [Role.SALON_OWNER]])("%s is turned away without a single register request", async (role) => {
    asUser([role]);
    const api = apiWith(async () => undefined);
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(api.probe).not.toHaveBeenCalled();
    expect(text(r)).not.toContain("REGISTER-CONTENT");
    expect(text(r)).toMatch(/limited to HR, Co-Founder and Platform Admin/);
  });

  test("a signed-out visitor sees nothing and triggers no request", async () => {
    asUser(null, "unauthenticated");
    const api = apiWith(async () => undefined);
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(api.probe).not.toHaveBeenCalled();
    expect(text(r)).not.toContain("REGISTER-CONTENT");
  });

  test("while the session is still loading, nothing is decided and nothing is requested", async () => {
    asUser(null, "loading");
    const api = apiWith(async () => undefined);
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(api.probe).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/Checking your access/);
  });

  test.each([404, 501, 503])("a server without the register (HTTP %i) fails closed with no manual-ID fallback", async (status) => {
    asUser([Role.HR_ADMIN]);
    const api = apiWith(async () => {
      throw apiError(status);
    });
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    const t = text(r);
    expect(t).not.toContain("REGISTER-CONTENT");
    expect(t).toMatch(/not available on this server yet/);
    expect(t).toMatch(/no manual fallback/);
  });

  test("the backend refusing the role (403) is respected even if the browser thought it was allowed", async () => {
    asUser([Role.HR_ADMIN]);
    const api = apiWith(async () => {
      throw apiError(403);
    });
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(text(r)).not.toContain("REGISTER-CONTENT");
    expect(text(r)).toMatch(/not permitted/);
  });

  test("other failures block the register and say why", async () => {
    asUser([Role.HR_ADMIN]);
    const api = apiWith(async () => {
      // Same shape lib/api.ts produces when fetch itself rejects.
      throw new ApiError(0, { error: { code: "NETWORK_OFFLINE", message: "You appear to be offline. Check your connection and try again." } });
    });
    const r = await mount(<RegisterGate api={api}>REGISTER-CONTENT</RegisterGate>);
    expect(text(r)).not.toContain("REGISTER-CONTENT");
    expect(text(r)).toMatch(/appear to be offline/);
  });
});
