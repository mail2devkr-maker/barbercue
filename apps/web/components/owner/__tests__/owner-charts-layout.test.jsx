import { average, monotonePath, niceMax } from "../chart-math";
import { buildScheduleLayout, CATEGORY_PALETTE, localMinutes, paletteIndex, PX_PER_HOUR, UNASSIGNED } from "../schedule-layout";

describe("chart maths", () => {
  it("draws a curve that never dips below a run of zero days (no invented loss)", () => {
    const y = (v) => 100 - v; // larger value = higher on screen = smaller y
    const points = [0, 0, 80, 80, 0, 0].map((v, i) => ({ x: i * 10, y: y(v) }));
    const path = monotonePath(points);
    expect(path.startsWith("M0.0,100.0")).toBe(true);
    // Every control point stays between the bounding y values of the data (0..80 high => y 20..100).
    const numbers = [...path.matchAll(/C([-\d.]+),([-\d.]+) ([-\d.]+),([-\d.]+)/g)].flatMap((m) => [Number(m[2]), Number(m[4])]);
    for (const value of numbers) {
      expect(value).toBeLessThanOrEqual(100.0001);
      expect(value).toBeGreaterThanOrEqual(19.9999);
    }
  });

  it("handles one point and no points without throwing", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 5, y: 7 }])).toBe("M5.0,7.0");
  });

  it("rounds an axis maximum up to a friendly number, and never to zero", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(1250)).toBe(2000);
    expect(niceMax(4800)).toBe(5000);
    expect(niceMax(7)).toBe(10);
  });

  it("only averages a series that exists", () => {
    expect(average([])).toBeNull();
    expect(average([100, 200, 300])).toBe(200);
  });
});

const item = (overrides = {}) => ({
  id: "b1",
  kind: "BOOKING",
  slotStart: "2026-10-13T04:00:00.000Z", // 09:30 IST
  slotEnd: "2026-10-13T04:30:00.000Z", // 10:00 IST
  status: "CONFIRMED",
  source: "ONLINE",
  serviceNames: ["Haircut"],
  customerLabel: "Customer",
  staffName: "Arjun",
  category: "Haircut",
  ...overrides,
});

describe("day schedule layout", () => {
  it("reads times in the shop's own timezone, not the device's", () => {
    expect(localMinutes("2026-10-13T04:00:00.000Z", "Asia/Kolkata")).toBe(9 * 60 + 30);
    expect(localMinutes("2026-10-13T04:00:00.000Z", "UTC")).toBe(4 * 60);
  });

  it("covers only the hours that have appointments, and places a block by its start and length", () => {
    const layout = buildScheduleLayout([item(), item({ id: "b2", slotStart: "2026-10-13T06:30:00.000Z", slotEnd: "2026-10-13T07:30:00.000Z", staffName: "Bilal" })], "Asia/Kolkata", ["Arjun", "Bilal"]);
    expect(layout.startHour).toBe(9);
    expect(layout.endHour).toBe(13); // last appointment ends 13:00
    expect(layout.columns).toEqual(["Arjun", "Bilal"]);
    const first = layout.blocks.find((b) => b.id === "b1");
    expect(first.top).toBe(30); // 09:30 is 30 minutes after the 09:00 grid start
    expect(first.height).toBe(30);
    const second = layout.blocks.find((b) => b.id === "b2");
    expect(second.top).toBe(180); // 12:00 is three hours after the 09:00 grid start
    expect(second.height).toBe(60);
    expect(PX_PER_HOUR).toBeGreaterThan(0);
  });

  it("puts an appointment with no barber in its own honest column instead of guessing one", () => {
    const layout = buildScheduleLayout([item({ staffName: null })], "Asia/Kolkata", ["Arjun"]);
    expect(layout.columns).toEqual(["Arjun", UNASSIGNED]);
    expect(layout.blocks[0].column).toBe(UNASSIGNED);
  });

  it("adds a column for a barber who has appointments but is no longer on the roster", () => {
    const layout = buildScheduleLayout([item({ staffName: "Former Barber" })], "Asia/Kolkata", ["Arjun"]);
    expect(layout.columns).toEqual(["Arjun", "Former Barber"]);
  });

  it("keeps a minimum readable height and a sane default window when the day is empty", () => {
    const empty = buildScheduleLayout([], "Asia/Kolkata", ["Arjun"]);
    expect(empty.endHour - empty.startHour).toBeGreaterThanOrEqual(3);
    const short = buildScheduleLayout([item({ slotEnd: "2026-10-13T04:05:00.000Z" })], "Asia/Kolkata", []);
    expect(short.blocks[0].height).toBeGreaterThanOrEqual(20);
  });

  it("colours a category the same way every day", () => {
    expect(paletteIndex("Haircut")).toBe(paletteIndex("  haircut "));
    expect(paletteIndex(null)).toBe(0);
    expect(paletteIndex("Colour")).toBeLessThan(CATEGORY_PALETTE.length);
  });
});
