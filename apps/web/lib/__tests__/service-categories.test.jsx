import { UNCATEGORISED, categoryKey, filterServices, groupForDisplay, listCategories } from "../service-categories";

const svc = (id, name, category, isActive = true) => ({ id, name, category, isActive });
const services = [
  svc("1", "Classic Haircut", "Haircut"),
  svc("2", "Fade", "haircut"),
  svc("3", "Layer Cut", " Haircut "),
  svc("4", "Head Massage", "Massage"),
  svc("5", "Full Body Massage", "Massage"),
  svc("6", "Beard Trim", "Beard"),
  svc("7", "Mystery", ""),
  svc("8", "Old Spa", "Spa", false),
  svc("9", "Nameless", null),
];

describe("categoryKey", () => {
  it("merges spelling, case and spacing variants into one key", () => {
    expect(categoryKey("Haircut")).toBe("haircut");
    expect(categoryKey(" haircut ")).toBe("haircut");
    expect(categoryKey("Hair   Spa")).toBe("hair spa");
    expect(categoryKey(null)).toBe("");
    expect(categoryKey(undefined)).toBe("");
  });
});

describe("listCategories", () => {
  it("merges variants, counts visible services, sorts A to Z and puts Uncategorised last", () => {
    const list = listCategories(services, false);
    expect(list.map((c) => [c.label, c.count])).toEqual([["Beard", 1], ["Haircut", 3], ["Massage", 2], [UNCATEGORISED, 2]]);
  });
  it("shows the first spelling seen as the label", () => {
    expect(listCategories(services, false).find((c) => c.key === "haircut").label).toBe("Haircut");
  });
  it("counts turned-off services only when they are included, the same rule as the list", () => {
    expect(listCategories(services, false).some((c) => c.key === "spa")).toBe(false);
    expect(listCategories(services, true).find((c) => c.key === "spa").count).toBe(1);
  });
  it("returns nothing for no services", () => {
    expect(listCategories([], true)).toEqual([]);
  });
});

describe("filterServices", () => {
  const base = { search: "", categoryKey: null, includeInactive: false };
  it("hides turned-off services unless asked", () => {
    expect(filterServices(services, base).map((s) => s.id)).not.toContain("8");
    expect(filterServices(services, { ...base, includeInactive: true }).map((s) => s.id)).toContain("8");
  });
  it("filters by category regardless of spelling", () => {
    expect(filterServices(services, { ...base, categoryKey: "haircut" }).map((s) => s.id)).toEqual(["1", "2", "3"]);
  });
  it("filters Uncategorised via the empty key", () => {
    expect(filterServices(services, { ...base, categoryKey: "" }).map((s) => s.id)).toEqual(["7", "9"]);
  });
  it("searches names case-insensitively and combines with a category", () => {
    expect(filterServices(services, { ...base, search: "MASSAGE" }).map((s) => s.id)).toEqual(["4", "5"]);
    expect(filterServices(services, { ...base, search: "body", categoryKey: "massage" }).map((s) => s.id)).toEqual(["5"]);
    expect(filterServices(services, { ...base, search: "body", categoryKey: "haircut" })).toEqual([]);
  });
  it("does not change or reorder the input", () => {
    const copy = JSON.stringify(services);
    filterServices(services, { ...base, search: "a" });
    expect(JSON.stringify(services)).toBe(copy);
  });
});

describe("groupForDisplay", () => {
  it("adds a heading per category with counts, categories A-Z, services A-Z, Uncategorised last", () => {
    const entries = groupForDisplay(filterServices(services, { search: "", categoryKey: null, includeInactive: false }));
    const compact = entries.map((e) => (e.kind === "heading" ? `# ${e.label} (${e.count})` : e.service.name));
    expect(compact).toEqual([
      "# Beard (1)", "Beard Trim",
      "# Haircut (3)", "Classic Haircut", "Fade", "Layer Cut",
      "# Massage (2)", "Full Body Massage", "Head Massage",
      `# ${UNCATEGORISED} (2)`, "Mystery", "Nameless",
    ]);
  });
  it("adds no heading when only one category is on screen", () => {
    const entries = groupForDisplay(filterServices(services, { search: "", categoryKey: "massage", includeInactive: false }));
    expect(entries.every((e) => e.kind === "service")).toBe(true);
    expect(entries).toHaveLength(2);
  });
  it("returns an empty list for no services", () => {
    expect(groupForDisplay([])).toEqual([]);
  });
});
