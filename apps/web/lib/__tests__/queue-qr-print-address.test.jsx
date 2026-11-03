import { formatQueueQrPrintAddress, layoutQueueQrPrintAddress } from "../queue-qr-print-address";

const approximateCanvasMeasure = (text, fontSize) =>
  Array.from(text).reduce((width, char) => width + fontSize * (char === " " ? 0.28 : 0.55), 0);

describe("4x6-inch queue poster bottom address", () => {
  it("uses the owner's stored street address and postal code without inventing a city", () => {
    expect(formatQueueQrPrintAddress("Cinema road hajipur", "844101")).toBe("Cinema road hajipur, 844101");
    expect(formatQueueQrPrintAddress("Cinema road, Hajipur 844101", "844101")).toBe("Cinema road, Hajipur 844101");
  });

  it("normalizes whitespace and never invents an address from only a PIN", () => {
    expect(formatQueueQrPrintAddress("  Main  Road\nNoida  ", "201301")).toBe("Main Road Noida, 201301");
    expect(formatQueueQrPrintAddress(" ", "844101")).toBe("");
  });

  it("puts a short address at the last physical poster baseline (inside the border)", () => {
    const addr = "Cinema road hajipur, 844101";
    const layout = layoutQueueQrPrintAddress(addr, approximateCanvasMeasure);
    expect(layout.lines.join(" ")).toBe(addr);
    expect(layout.firstBaseline + (layout.lines.length - 1) * layout.lineHeight).toBe(587);
    expect(layout.firstBaseline).toBeGreaterThanOrEqual(563);
    layout.lines.forEach((line) => {
      expect(approximateCanvasMeasure(line, layout.fontSize)).toBeLessThanOrEqual(layout.maxWidth);
    });
  });

  it("does not truncate long existing or non-Latin addresses", () => {
    for (const input of [
      "Near the International Conference Complex, Beside The Old Government Medical College and Community Wellness Centre, Ward 12, Sambalpur, Odisha, 768001",
      "माँ दुर्गा ब्यूटी पार्लर, मुख्य बाजार, हाजीपुर, बिहार, 844101",
      "A".repeat(180),
    ]) {
      const layout = layoutQueueQrPrintAddress(input, approximateCanvasMeasure);
      expect(layout.lines.length).toBeLessThanOrEqual(4);
      // Automatic word/character wrapping may split a non-spaced address;
      // only the visual newline boundaries are allowed to differ.
      expect(layout.lines.join(input.includes(" ") ? " " : "")).toBe(input);
      expect(layout.firstBaseline + (layout.lines.length - 1) * layout.lineHeight).toBe(587);
    }
  });
});
