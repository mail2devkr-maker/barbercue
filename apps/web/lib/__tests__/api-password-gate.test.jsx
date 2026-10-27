import { ApiError, PASSWORD_CHANGE_PATH, redirectIfPasswordChangeRequired } from "../api";

const err = (status, code) => new ApiError(status, { error: { code, message: "x" } });

describe("redirectIfPasswordChangeRequired (owner transfer, mandatory password change)", () => {
  afterEach(() => { delete global.window; });
  const withWindow = (pathname) => {
    const assign = jest.fn();
    global.window = { location: { pathname, assign } };
    return assign;
  };

  it("sends the person to the change-password page when the backend demands it", () => {
    const assign = withWindow("/dashboard/salons/s1");
    redirectIfPasswordChangeRequired(err(403, "PASSWORD_CHANGE_REQUIRED"));
    expect(assign).toHaveBeenCalledWith(PASSWORD_CHANGE_PATH);
    expect(PASSWORD_CHANGE_PATH).toBe("/change-password-required");
  });
  it("does not loop when already on that page", () => {
    const assign = withWindow(PASSWORD_CHANGE_PATH);
    redirectIfPasswordChangeRequired(err(403, "PASSWORD_CHANGE_REQUIRED"));
    expect(assign).not.toHaveBeenCalled();
  });
  it("ignores every other error, including other 403s and a 401 with the same code", () => {
    const assign = withWindow("/dashboard");
    redirectIfPasswordChangeRequired(err(403, "FORBIDDEN"));
    redirectIfPasswordChangeRequired(err(401, "PASSWORD_CHANGE_REQUIRED"));
    redirectIfPasswordChangeRequired(err(500, "PASSWORD_CHANGE_REQUIRED"));
    expect(assign).not.toHaveBeenCalled();
  });
  it("does nothing outside a browser", () => {
    expect(() => redirectIfPasswordChangeRequired(err(403, "PASSWORD_CHANGE_REQUIRED"))).not.toThrow();
  });
});
