import type { SalonServiceCategoryDto, SalonServiceDto } from "@barbercue/shared";

// Owner service categories and subcategories (requirement #7) on Codex's docs/contracts/FASTQUE_SERVICE_TAXONOMY_V1.md
// (PR #258/#259, in the #265 integration):
//   GET   dashboard/salons/:id/service-categories                      -> [{ id, name, subcategories: [{ id, name }] }]
//   POST  dashboard/salons/:id/service-categories {name}               (creates, or returns the existing one with the same normalised name)
//   PATCH/DELETE .../service-categories/:categoryId                    (rename; delete only when empty)
//   POST  .../service-categories/:categoryId/subcategories {name}      PATCH/DELETE .../subcategories/:subcategoryId
// A service carries the legacy text (`category`, `subcategory`) and the stable ids (`categoryId`, `subcategoryId`). Each shop owns
// its own tree; an old server without the routes keeps the plain text box.

export const MAX_NAME = 60;

export type ServiceTree = SalonServiceCategoryDto[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads the tree defensively: rows without a string id and name are dropped, never guessed. */
export function parseServiceTree(raw: unknown): ServiceTree | null {
  if (!Array.isArray(raw)) return null;
  const tree: ServiceTree = [];
  for (const row of raw) {
    if (!isRecord(row) || typeof row.id !== "string" || typeof row.name !== "string") continue;
    const subs = Array.isArray(row.subcategories) ? row.subcategories : [];
    tree.push({
      id: row.id,
      name: row.name,
      subcategories: subs.filter((s): s is { id: string; name: string } => isRecord(s) && typeof s.id === "string" && typeof s.name === "string").map((s) => ({ id: s.id, name: s.name })),
    });
  }
  return tree;
}

/** The comparison key the server uses for "the same name": trimmed, spaces collapsed, case-insensitive. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateNodeName(name: string): string | null {
  const t = name.trim();
  if (t.length === 0) return "Enter a name.";
  if (t.length > MAX_NAME) return `Use at most ${MAX_NAME} characters.`;
  return null;
}

/** The existing node a new name would converge onto (the server returns the existing one rather than adding a duplicate). */
export function existingNode<T extends { id: string; name: string }>(nodes: ReadonlyArray<T>, name: string, exceptId?: string): T | null {
  const key = nameKey(name);
  return key === "" ? null : (nodes.find((n) => n.id !== exceptId && nameKey(n.name) === key) ?? null);
}

export function sortedTree(tree: ServiceTree): ServiceTree {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  return [...tree].sort(byName).map((c) => ({ ...c, subcategories: [...c.subcategories].sort(byName) }));
}

/** How many of these services sit in a category / subcategory (by id; a legacy service without ids matches by its text). */
export function serviceCounts(tree: ServiceTree, services: ReadonlyArray<Pick<SalonServiceDto, "category" | "subcategory" | "categoryId" | "subcategoryId">>) {
  const categories = new Map<string, number>();
  const subcategories = new Map<string, number>();
  for (const c of tree) {
    categories.set(c.id, 0);
    for (const s of c.subcategories) subcategories.set(s.id, 0);
  }
  for (const svc of services) {
    const category =
      (svc.categoryId && categories.has(svc.categoryId) ? tree.find((c) => c.id === svc.categoryId) : undefined) ??
      tree.find((c) => nameKey(c.name) === nameKey(svc.category) && nameKey(svc.category) !== "");
    if (!category) continue;
    categories.set(category.id, (categories.get(category.id) ?? 0) + 1);
    const sub =
      (svc.subcategoryId ? category.subcategories.find((s) => s.id === svc.subcategoryId) : undefined) ??
      category.subcategories.find((s) => nameKey(s.name) === nameKey(svc.subcategory) && nameKey(svc.subcategory) !== "");
    if (sub) subcategories.set(sub.id, (subcategories.get(sub.id) ?? 0) + 1);
  }
  return { categories, subcategories };
}

// ---------- choosing a category for one service ----------

/** The select value meaning "a new one": the name is typed in `newCategory` / `newSubcategory`. */
export const NEW_NODE = "__new__";

/** What the owner picked in the service form. An existing node is chosen by id; a new name is typed. */
export interface TaxonomyChoice {
  categoryId: string;
  newCategory: string;
  subcategoryId: string;
  newSubcategory: string;
}

export const EMPTY_CHOICE: TaxonomyChoice = { categoryId: "", newCategory: "", subcategoryId: "", newSubcategory: "" };

/** The choice that matches a saved service: by its ids, else by its text, else its text as a name still to be created. */
export function choiceFromService(service: Pick<SalonServiceDto, "category" | "subcategory" | "categoryId" | "subcategoryId">, tree: ServiceTree | null): TaxonomyChoice {
  const categoryText = (service.category ?? "").trim();
  const subText = (service.subcategory ?? "").trim();
  if (!tree) return { ...EMPTY_CHOICE, newCategory: categoryText, newSubcategory: subText };
  const category = tree.find((c) => c.id === service.categoryId) ?? (categoryText ? existingNode(tree, categoryText) : null);
  if (!category) return { ...EMPTY_CHOICE, newCategory: categoryText, newSubcategory: subText };
  const sub = category.subcategories.find((s) => s.id === service.subcategoryId) ?? (subText ? existingNode(category.subcategories, subText) : null);
  return { categoryId: category.id, newCategory: "", subcategoryId: sub?.id ?? "", newSubcategory: sub ? "" : subText };
}

const realId = (id: string): string => (id === NEW_NODE ? "" : id);

export function choiceProblem(choice: TaxonomyChoice): string | null {
  if (choice.categoryId === NEW_NODE || (choice.categoryId === "" && choice.newCategory.trim() !== "")) {
    const p = validateNodeName(choice.newCategory);
    if (p) return `Category: ${p}`;
  }
  if (choice.subcategoryId === NEW_NODE || choice.newSubcategory.trim() !== "") {
    const hasCategory = realId(choice.categoryId) !== "" || choice.newCategory.trim() !== "";
    if (!hasCategory) return "Choose a category before adding a subcategory.";
    const p = validateNodeName(choice.newSubcategory);
    if (p) return `Subcategory: ${p}`;
  }
  return null;
}

/**
 * The category fields of a create or update request. An existing node goes by id; a new name goes as text and the server adds it to
 * the shop's tree (or reuses the same name). On an update, choosing none clears the text and the link (the server's `null`).
 */
export function taxonomyFields(choice: TaxonomyChoice, mode: "create" | "update"): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const categoryId = realId(choice.categoryId);
  const subcategoryId = realId(choice.subcategoryId);
  const newCategory = choice.newCategory.trim();
  const newSub = choice.newSubcategory.trim();
  if (categoryId) {
    fields.categoryId = categoryId;
    if (subcategoryId) fields.subcategoryId = subcategoryId;
    else if (newSub) fields.subcategory = newSub;
    else if (mode === "update") fields.subcategory = null;
  } else if (newCategory) {
    fields.category = newCategory;
    if (newSub) fields.subcategory = newSub;
    else if (mode === "update") fields.subcategory = null;
  } else if (mode === "update") {
    fields.category = null;
    fields.subcategory = null;
  }
  return fields;
}

export function taxonomyErrorText(code: string | undefined, message: string): string {
  switch (code) {
    case "SERVICE_TAXONOMY_INVALID":
      return "That category does not belong to your shop or does not match the name given. Reload the page and choose it again.";
    case "SERVICE_TAXONOMY_NOT_FOUND":
      return "That category no longer exists. Reload the page.";
    case "SERVICE_TAXONOMY_IN_USE":
      return "This still has services or subcategories in it. Move or remove them first, then delete it.";
    case "SERVICE_TAXONOMY_NAME_CONFLICT":
      return "Another category already has that name. Choose a different name.";
    default:
      return message;
  }
}

/** The label shown for a service's category line: "Hair > Cut", "Hair", or nothing. */
export function categoryLine(service: Pick<SalonServiceDto, "category" | "subcategory">): string {
  const c = (service.category ?? "").trim();
  const s = (service.subcategory ?? "").trim();
  if (!c) return "";
  return s ? `${c} › ${s}` : c;
}
