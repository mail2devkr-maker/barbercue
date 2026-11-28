// Owner Services page: grouping, category filter and name search (requirement #7).
//
// A service has ONE free-text `category` today (ServiceDto.category, "" when none). This module groups and
// filters on that value only. Real subcategories need a category tree from the server (requested in the
// contract issue), so nothing here pretends to be one. Existing and imported services are never changed:
// this only decides how they are listed.

export const UNCATEGORISED = "Uncategorised";

export interface CategorisedService {
  id: string;
  name: string;
  category: string | null | undefined;
  isActive: boolean;
}

export interface CategoryOption {
  /** Stable key: the trimmed, lower-cased category ("" for uncategorised). */
  key: string;
  /** Display name: the first spelling seen ("Hair", never "hair" and "HAIR" as two groups). */
  label: string;
  count: number;
}

export type ServiceListEntry<T extends CategorisedService> =
  | { kind: "heading"; key: string; label: string; count: number }
  | { kind: "service"; service: T };

export function categoryKey(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function categoryLabel(category: string | null | undefined): string {
  const trimmed = (category ?? "").trim().replace(/\s+/g, " ");
  return trimmed || UNCATEGORISED;
}

/**
 * The categories present among `services`, alphabetical, with Uncategorised last. Counts follow the SAME
 * visibility rule as the list (inactive services only when `includeInactive`), so a chip never promises
 * more rows than the list will show.
 */
export function listCategories<T extends CategorisedService>(services: ReadonlyArray<T>, includeInactive: boolean): CategoryOption[] {
  const map = new Map<string, CategoryOption>();
  for (const s of services) {
    if (!s.isActive && !includeInactive) continue;
    const key = categoryKey(s.category);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { key, label: categoryLabel(s.category), count: 1 });
  }
  return [...map.values()].sort((a, b) => {
    if (a.key === "") return 1;
    if (b.key === "") return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
}

export interface ServiceFilter {
  search: string;
  /** null = every category; otherwise a category key (see categoryKey). */
  categoryKey: string | null;
  includeInactive: boolean;
}

/** Applies visibility, category and name search. Order is kept as given so editing in place never reshuffles the list. */
export function filterServices<T extends CategorisedService>(services: ReadonlyArray<T>, filter: ServiceFilter): T[] {
  const needle = filter.search.trim().toLowerCase();
  return services.filter((s) => {
    if (!s.isActive && !filter.includeInactive) return false;
    if (filter.categoryKey !== null && categoryKey(s.category) !== filter.categoryKey) return false;
    if (needle && !s.name.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/**
 * Flat list with a heading before each category's services (alphabetical categories, Uncategorised last,
 * services alphabetical inside a category). A heading is only produced when more than one category is on
 * screen; a single category needs no extra heading.
 */
export function groupForDisplay<T extends CategorisedService>(services: ReadonlyArray<T>): Array<ServiceListEntry<T>> {
  const groups = new Map<string, { label: string; items: T[] }>();
  for (const s of services) {
    const key = categoryKey(s.category);
    const group = groups.get(key) ?? { label: categoryLabel(s.category), items: [] };
    group.items.push(s);
    groups.set(key, group);
  }
  const ordered = [...groups.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === "") return 1;
    if (kb === "") return -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
  });
  const entries: Array<ServiceListEntry<T>> = [];
  for (const [key, group] of ordered) {
    if (ordered.length > 1) entries.push({ kind: "heading", key, label: group.label, count: group.items.length });
    for (const service of [...group.items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))) {
      entries.push({ kind: "service", service });
    }
  }
  return entries;
}
