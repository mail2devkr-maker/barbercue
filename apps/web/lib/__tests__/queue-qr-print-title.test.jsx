import { layoutQueueQrPrintTitle } from "../queue-qr-print-title";

const approximateCanvasMeasure = (text, fontSize) =>
  Array.from(text).reduce((width, char) => width + fontSize * (char === " " ? 0.3 : 0.58), 0);

describe("standalone 4×6-inch QR export salon name", () => {
  it("keeps a short shop name on one readable line", () => {
    const result = layoutQueueQrPrintTitle("Glam Studio", approximateCanvasMeasure);
    expect(result.lines).toEqual(["Glam Studio"]);
    expect(result.fontSize).toBeGreaterThanOrEqual(20);
  });

  it("wraps Sakhi Beauty Salon and academy instead of spilling off the poster", () => {
    const input = "Sakhi Beauty Salon and academy";
    const result = layoutQueueQrPrintTitle(input, approximateCanvasMeasure);
    expect(result.lines.length).toBeGreaterThan(1);
    expect(result.lines.join(" ")).toBe(input);
    result.lines.forEach((line) =>
      expect(approximateCanvasMeasure(line, result.fontSize)).toBeLessThanOrEqual(result.maxWidth),
    );
  });

  it("keeps every word of a very long onboarded salon name in at most four lines", () => {
    const input = "The Extraordinary International Beauty Wellness Academy Haircare Spa and Salon Center";
    const result = layoutQueueQrPrintTitle(input, approximateCanvasMeasure);
    expect(result.lines.length).toBeLessThanOrEqual(4);
    expect(result.lines.join(" ")).toBe(input);
  });

  it("supports Unicode names and collapses odd whitespace safely", () => {
    const result = layoutQueueQrPrintTitle("  माँ दुर्गा   ब्यूटी  पार्लर  ", approximateCanvasMeasure);
    expect(result.lines.join(" ")).toBe("माँ दुर्गा ब्यूटी पार्लर");
  });
});
