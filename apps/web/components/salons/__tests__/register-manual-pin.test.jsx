import { parseManualPin } from "../RegisterSalonForm";

describe("parseManualPin", () => {
  it("treats two empty boxes as no pin", () => {
    expect(parseManualPin("", "  ")).toEqual({ kind: "none" });
  });

  it("accepts a valid pin and rounds to 5 decimals", () => {
    expect(parseManualPin(" 28.6139391 ", "77.2090212")).toEqual({ kind: "ok", lat: 28.61394, lng: 77.20902 });
  });

  it("rejects half a pin, text, out-of-range and 0,0", () => {
    expect(parseManualPin("28.6", "").kind).toBe("error");
    expect(parseManualPin("abc", "77").kind).toBe("error");
    expect(parseManualPin("91", "77").kind).toBe("error");
    expect(parseManualPin("28", "181").kind).toBe("error");
    expect(parseManualPin("0", "0").kind).toBe("error");
  });
});
