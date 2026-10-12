import { formatMoney, formatPercentChange, greetingFor, initialsOf } from "../format";

describe("owner dashboard formatting", () => {
  it("shows rupees with the sign and Indian digit grouping", () => {
    expect(formatMoney(1234567.5, "INR")).toBe("₹12,34,567.50");
    expect(formatMoney(710, "INR")).toBe("₹710");
    expect(formatMoney(25000, "INR", { compact: true })).toBe("₹25,000");
  });
  it("uses an ISO code, not a guessed symbol, for other currencies", () => {
    expect(formatMoney(12.5, "USD")).toBe("USD 12.50");
  });
  it("never invents a percentage when there is nothing to compare with", () => {
    expect(formatPercentChange(null)).toEqual({ text: "No earlier data", tone: "flat" });
    expect(formatPercentChange(12.5)).toEqual({ text: "+12.5%", tone: "up" });
    expect(formatPercentChange(-3)).toEqual({ text: "-3%", tone: "down" });
    expect(formatPercentChange(0)).toEqual({ text: "No change", tone: "flat" });
  });
  it("greets by the hour and derives initials without exposing an e-mail", () => {
    expect(greetingFor(7)).toBe("Good morning");
    expect(greetingFor(14)).toBe("Good afternoon");
    expect(greetingFor(20)).toBe("Good evening");
    expect(initialsOf("owner.19dfc0@fastque-demo.test")).toBe("OW");
    expect(initialsOf("")).toBe("?");
  });
});
