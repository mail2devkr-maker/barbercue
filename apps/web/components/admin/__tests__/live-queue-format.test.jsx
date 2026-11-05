import { waitedMinutes, waitText } from "../live-queue-format";

describe("live queue monitoring format", () => {
  const now = Date.parse("2026-11-05T10:00:00.000Z");
  it("minutes waited from the oldest join time", () => {
    expect(waitedMinutes("2026-11-05T09:20:30.000Z", now)).toBe(39);
    expect(waitedMinutes(null, now)).toBeNull();
    expect(waitedMinutes("2026-11-05T10:05:00.000Z", now)).toBe(0); // clock skew never goes negative
  });
  it("plain text for the wait", () => {
    expect(waitText(null)).toBe("Nobody waiting");
    expect(waitText(7)).toBe("7 min");
    expect(waitText(135)).toBe("2 h 15 min");
  });
});
