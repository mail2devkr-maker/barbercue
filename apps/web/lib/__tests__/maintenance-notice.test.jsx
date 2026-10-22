// The advance maintenance announcement states the approved start and does not invent an end time.
import {
  MAINTENANCE_END,
  MAINTENANCE_HEADLINE,
  MAINTENANCE_MESSAGE,
  MAINTENANCE_START,
  MAINTENANCE_WINDOW_TEXT,
  isMaintenanceNoticeVisible,
} from "../maintenance-notice";

const ist = (iso) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

describe("the approved window", () => {
  it("starts at 12:00 AM IST on Friday, 23 October 2026 and has no unapproved end", () => {
    expect(ist(MAINTENANCE_START)).toMatch(/23 October 2026.*00:00/);
    expect(MAINTENANCE_END).toBeNull();
  });

  it("names the right weekday", () => {
    // 23 October 2026 is a Friday.
    expect(new Date(Date.UTC(2026, 9, 23)).getUTCDay()).toBe(5);
    expect(MAINTENANCE_WINDOW_TEXT).toBe("Starting Friday, 23 October 2026, at 12:00 AM IST");
  });

  it("says what is being announced and does not promise more than that", () => {
    expect(MAINTENANCE_HEADLINE).toBe("Scheduled maintenance");
    expect(MAINTENANCE_MESSAGE).toMatch(/may be unavailable or slow/);
    expect(MAINTENANCE_MESSAGE).not.toMatch(/will be (down|offline|unavailable)/i);
  });
});

describe("isMaintenanceNoticeVisible", () => {
  it("shows the notice before and after the stated start until a release removes it", () => {
    expect(isMaintenanceNoticeVisible(Date.parse("2026-10-21T07:00:00.000Z"))).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse(MAINTENANCE_START) - 1)).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse(MAINTENANCE_START))).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse("2026-10-23T20:00:00.000Z"))).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse("2026-11-01T00:00:00.000Z"))).toBe(true);
  });

  it("keeps showing it when the clock value is unusable rather than throwing", () => {
    expect(isMaintenanceNoticeVisible(Number.NaN)).toBe(true);
  });
});
