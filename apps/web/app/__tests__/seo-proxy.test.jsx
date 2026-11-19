import { proxy } from "../../proxy";

function request(url) {
  const parsed = new URL(url);
  return {
    url,
    nextUrl: parsed,
    headers: new Headers({ host: parsed.host }),
    cookies: { has: () => false },
  };
}

describe("SEO canonical host proxy", () => {
  it("redirects the www alias before any route-specific auth check", () => {
    const response = proxy(request("http://www.fastque.com/dashboard/admin?tab=shops"));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://fastque.com/dashboard/admin?tab=shops");
  });

  it("leaves ordinary public pages alone", () => {
    const response = proxy(request("https://fastque.com/search"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
