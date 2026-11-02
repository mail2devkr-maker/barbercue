// The advance maintenance announcement shows the owner-approved window exactly: 22 October 2026, 12:00 AM to 4:00 AM IST.
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
  it("starts at 12:00 AM and ends at 4:00 AM IST on 22 October 2026", () => {
    expect(ist(MAINTENANCE_START)).toMatch(/22 October 2026.*00:00/);
    expect(ist(MAINTENANCE_END)).toMatch(/22 October 2026.*04:00/);
    expect(Date.parse(MAINTENANCE_END) - Date.parse(MAINTENANCE_START)).toBe(4 * 3600_000);
  });

  it("names the right weekday", () => {
    // 22 October 2026 is a Thursday.
    expect(new Date(Date.UTC(2026, 9, 22)).getUTCDay()).toBe(4);
    expect(MAINTENANCE_WINDOW_TEXT).toBe("Thursday, 22 October 2026, 12:00 AM to 4:00 AM IST");
  });

  it("says what is being announced and does not promise more than that", () => {
    expect(MAINTENANCE_HEADLINE).toBe("Scheduled maintenance");
    expect(MAINTENANCE_MESSAGE).toMatch(/may be unavailable or slow/);
    expect(MAINTENANCE_MESSAGE).not.toMatch(/will be (down|offline|unavailable)/i);
  });
});

describe("isMaintenanceNoticeVisible", () => {
  const end = Date.parse(MAINTENANCE_END);

  it("shows the notice well before, just before, at the start of and during the window", () => {
    expect(isMaintenanceNoticeVisible(Date.parse("2026-10-21T07:00:00.000Z"))).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse(MAINTENANCE_START) - 1)).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse(MAINTENANCE_START))).toBe(true);
    expect(isMaintenanceNoticeVisible(Date.parse("2026-10-21T20:00:00.000Z"))).toBe(true);
    expect(isMaintenanceNoticeVisible(end - 1)).toBe(true);
  });

  it("removes it once the window has ended", () => {
    expect(isMaintenanceNoticeVisible(end)).toBe(false);
    expect(isMaintenanceNoticeVisible(end + 60_000)).toBe(false);
    expect(isMaintenanceNoticeVisible(Date.parse("2026-11-01T00:00:00.000Z"))).toBe(false);
  });

  it("keeps showing it when the clock value is unusable rather than throwing", () => {
    expect(isMaintenanceNoticeVisible(Number.NaN)).toBe(true);
  });
});
