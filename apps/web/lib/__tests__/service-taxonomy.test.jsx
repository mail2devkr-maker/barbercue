// Owner service category tree rules (Codex PR #258/#259 contract FASTQUE_SERVICE_TAXONOMY_V1).
import * as T from "../service-taxonomy";

const TREE = [
  { id: "c-hair", name: "Hair", subcategories: [{ id: "s-cut", name: "Cut" }, { id: "s-colour", name: "Colour" }] },
  { id: "c-skin", name: "Skin", subcategories: [] },
];

describe("parseServiceTree", () => {
  it("reads the server tree and drops rows it cannot trust", () => {
    expect(T.parseServiceTree(TREE)).toEqual(TREE);
    expect(T.parseServiceTree([{ id: 1, name: "x" }, { id: "a" }, null, { id: "b", name: "B", subcategories: [{ id: "x" }, { id: "y", name: "Y" }] }])).toEqual([
      { id: "b", name: "B", subcategories: [{ id: "y", name: "Y" }] },
    ]);
  });
  it("returns null for anything that is not a list", () => {
    for (const raw of [null, undefined, {}, "x", 3]) expect(T.parseServiceTree(raw)).toBeNull();
  });
});

describe("names", () => {
  it("compares the way the server does: trimmed, collapsed spaces, case-insensitive", () => {
    expect(T.nameKey("  Hair   Care ")).toBe("hair care");
    expect(T.existingNode(TREE, " HAIR ")?.id).toBe("c-hair");
    expect(T.existingNode(TREE, "Hair", "c-hair")).toBeNull();
    expect(T.existingNode(TREE, "")).toBeNull();
  });
  it("accepts 1 to 60 characters", () => {
    expect(T.validateNodeName("")).toBeTruthy();
    expect(T.validateNodeName("   ")).toBeTruthy();
    expect(T.validateNodeName("x".repeat(61))).toContain("60");
    expect(T.validateNodeName("Hair")).toBeNull();
  });
});

describe("counts", () => {
  it("counts services by id, and legacy services by their text", () => {
    const counts = T.serviceCounts(TREE, [
      { category: "Hair", subcategory: "Cut", categoryId: "c-hair", subcategoryId: "s-cut" },
      { category: "hair", subcategory: "colour", categoryId: null, subcategoryId: null },
      { category: "Skin", subcategory: null, categoryId: "c-skin", subcategoryId: null },
      { category: "Unknown", subcategory: null, categoryId: null, subcategoryId: null },
      { category: null, subcategory: null, categoryId: null, subcategoryId: null },
    ]);
    expect(counts.categories.get("c-hair")).toBe(2);
    expect(counts.categories.get("c-skin")).toBe(1);
    expect(counts.subcategories.get("s-cut")).toBe(1);
    expect(counts.subcategories.get("s-colour")).toBe(1);
  });
});

describe("choosing a category for a service", () => {
  it("starts from the saved ids, else from the text, else keeps the text as a new name", () => {
    expect(T.choiceFromService({ category: "Hair", subcategory: "Cut", categoryId: "c-hair", subcategoryId: "s-cut" }, TREE)).toEqual({ categoryId: "c-hair", newCategory: "", subcategoryId: "s-cut", newSubcategory: "" });
    expect(T.choiceFromService({ category: "HAIR", subcategory: "colour", categoryId: null, subcategoryId: null }, TREE)).toMatchObject({ categoryId: "c-hair", subcategoryId: "s-colour" });
    expect(T.choiceFromService({ category: "Nails", subcategory: "Gel", categoryId: null, subcategoryId: null }, TREE)).toEqual({ categoryId: "", newCategory: "Nails", subcategoryId: "", newSubcategory: "Gel" });
    expect(T.choiceFromService({ category: "Nails", subcategory: null, categoryId: null, subcategoryId: null }, null)).toMatchObject({ newCategory: "Nails" });
  });

  it("sends an existing node by id and a new name as text when creating", () => {
    expect(T.taxonomyFields({ ...T.EMPTY_CHOICE, categoryId: "c-hair", subcategoryId: "s-cut" }, "create")).toEqual({ categoryId: "c-hair", subcategoryId: "s-cut" });
    expect(T.taxonomyFields({ ...T.EMPTY_CHOICE, categoryId: "c-hair", newSubcategory: "Wash" }, "create")).toEqual({ categoryId: "c-hair", subcategory: "Wash" });
    expect(T.taxonomyFields({ ...T.EMPTY_CHOICE, categoryId: T.NEW_NODE, newCategory: " Nails ", subcategoryId: T.NEW_NODE, newSubcategory: "Gel" }, "create")).toEqual({ category: "Nails", subcategory: "Gel" });
    expect(T.taxonomyFields(T.EMPTY_CHOICE, "create")).toEqual({});
  });

  it("clears the link with null when an edit chooses none", () => {
    expect(T.taxonomyFields(T.EMPTY_CHOICE, "update")).toEqual({ category: null, subcategory: null });
    expect(T.taxonomyFields({ ...T.EMPTY_CHOICE, categoryId: "c-hair" }, "update")).toEqual({ categoryId: "c-hair", subcategory: null });
    expect(T.taxonomyFields({ ...T.EMPTY_CHOICE, categoryId: T.NEW_NODE, newCategory: "Nails" }, "update")).toEqual({ category: "Nails", subcategory: null });
  });

  it("explains an unusable choice", () => {
    expect(T.choiceProblem(T.EMPTY_CHOICE)).toBeNull();
    expect(T.choiceProblem({ ...T.EMPTY_CHOICE, categoryId: T.NEW_NODE })).toContain("Category");
    expect(T.choiceProblem({ ...T.EMPTY_CHOICE, categoryId: T.NEW_NODE, newCategory: "x".repeat(61) })).toContain("60");
    expect(T.choiceProblem({ ...T.EMPTY_CHOICE, newSubcategory: "Cut" })).toContain("Choose a category");
    expect(T.choiceProblem({ ...T.EMPTY_CHOICE, categoryId: "c-hair", subcategoryId: T.NEW_NODE })).toContain("Subcategory");
    expect(T.choiceProblem({ ...T.EMPTY_CHOICE, categoryId: "c-hair", subcategoryId: T.NEW_NODE, newSubcategory: "Wash" })).toBeNull();
  });
});

describe("words", () => {
  it("explains the server's taxonomy errors", () => {
    expect(T.taxonomyErrorText("SERVICE_TAXONOMY_IN_USE", "m")).toContain("Move or remove");
    expect(T.taxonomyErrorText("SERVICE_TAXONOMY_NAME_CONFLICT", "m")).toContain("already has that name");
    expect(T.taxonomyErrorText("SERVICE_TAXONOMY_INVALID", "m")).toContain("does not belong");
    expect(T.taxonomyErrorText("X", "as sent")).toBe("as sent");
  });
  it("prints a category line", () => {
    expect(T.categoryLine({ category: "Hair", subcategory: "Cut" })).toBe("Hair › Cut");
    expect(T.categoryLine({ category: "Hair", subcategory: null })).toBe("Hair");
    expect(T.categoryLine({ category: null, subcategory: "Cut" })).toBe("");
  });
  it("sorts a tree by name at both levels", () => {
    const sorted = T.sortedTree([{ id: "b", name: "b", subcategories: [{ id: "2", name: "z" }, { id: "1", name: "A" }] }, { id: "a", name: "A", subcategories: [] }]);
    expect(sorted.map((c) => c.id)).toEqual(["a", "b"]);
    expect(sorted[1].subcategories.map((s) => s.id)).toEqual(["1", "2"]);
  });
});
