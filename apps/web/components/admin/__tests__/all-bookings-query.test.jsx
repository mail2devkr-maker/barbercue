import { adminBookingsQuery, istDateTime } from "../all-bookings-query";

describe("admin all bookings helpers", () => {
  const none = { shop: "", status: "", from: "", to: "" };
  it("builds only the filters that are set", () => {
    expect(adminBookingsQuery(none)).toBe("");
    expect(
      adminBookingsQuery({
        ...none,
        shop: "  Handsome  ",
        status: "CANCELLED",
      }),
    ).toBe("?shop=Handsome&status=CANCELLED");
    expect(
      adminBookingsQuery({ ...none, from: "2026-11-01", to: "bad" }, "abc"),
    ).toBe("?from=2026-11-01&cursor=abc");
  });
  it("shows appointment time in IST", () => {
    expect(istDateTime("2030-01-10T04:30:00.000Z")).toMatch(
      /10 Jan 2030.*10:00/,
    );
  });
});
