"use client";

import { useMemo, useState } from "react";
import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_CATEGORIES,
  SERVICE_CATALOG_PACKS,
  normalizeServiceIdentity,
  type SalonServiceDto,
  type ServiceCatalogItem,
  type ServicePackId,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

interface CatalogDraft {
  item: ServiceCatalogItem;
  price: string;
  durationMinutes: string;
  description: string;
}

// Duration has a real canonical default (ServiceCatalogItem.defaultDurationMinutes); price
// deliberately does not (see service-catalog.ts's own doc comment) — every shop must enter and
// confirm its own price, so this never fabricates one. Shared by both the individual toggle and
// Select All so both paths create a new draft identically.
function emptyDraft(item: ServiceCatalogItem): CatalogDraft {
  return {
    item,
    price: "",
    durationMinutes: String(item.defaultDurationMinutes),
    description: "",
  };
}

function priceIsValid(price: string): boolean {
  if (price.trim() === "") return false;
  const value = Number(price);
  return Number.isFinite(value) && value >= 0;
}

export function ServiceCatalogPicker({
  basePath,
  services,
  currencyLabel,
  onCreated,
  onReactivated,
  onError,
}: {
  basePath: string;
  services: SalonServiceDto[];
  currencyLabel: string;
  onCreated: (created: SalonServiceDto[]) => void;
  onReactivated: (service: SalonServiceDto) => void;
  onError: (message: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [pack, setPack] = useState<ServicePackId>("BASIC");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<Record<string, CatalogDraft>>({});
  const [bulkPrice, setBulkPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<string | null>(null);

  const existingByIdentity = useMemo(
    () => new Map(services.map((service) => [
      normalizeServiceIdentity(service.name, service.category),
      service,
    ])),
    [services],
  );

  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return SERVICE_CATALOG.filter((catalogItem) =>
      catalogItem.pack === pack &&
      (category === "all" || catalogItem.category === category) &&
      (!search || `${catalogItem.name} ${catalogItem.category}`.toLowerCase().includes(search)),
    );
  }, [category, pack, query]);

  // Bulk selection is intentionally pack-scoped: owners can pick a whole pack instead of
  // clicking dozens of services, while prices remain owner-confirmed before save.
  const selectableCatalog = useMemo(
    () => SERVICE_CATALOG.filter(
      (catalogItem) =>
        catalogItem.pack === pack &&
        !existingByIdentity.has(normalizeServiceIdentity(catalogItem.name, catalogItem.category)),
    ),
    [existingByIdentity, pack],
  );
  const allSelected = selectableCatalog.length > 0 && selectableCatalog.every((item) => selected[item.id]);
  const packCategories = SERVICE_CATALOG_CATEGORIES.filter((name) =>
    SERVICE_CATALOG.some((item) => item.pack === pack && item.category === name),
  );

  function toggle(item: ServiceCatalogItem) {
    const existing = existingByIdentity.get(normalizeServiceIdentity(item.name, item.category));
    if (existing) return;
    setSelected((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return { ...current, [item.id]: emptyDraft(item) };
    });
    onError(null);
  }

  // Adds a fresh draft (canonical default duration, blank price) for every selectable catalog
  // item that isn't already selected — an already-selected item's draft, including any price/
  // duration the owner already edited, is left completely untouched, never recreated.
  function selectAll() {
    setSelected((current) => {
      const next = { ...current };
      for (const item of selectableCatalog) {
        if (!next[item.id]) next[item.id] = emptyDraft(item);
      }
      return next;
    });
    onError(null);
  }

  // Deselecting must not leave a stale draft behind for any item — clearing the whole map is the
  // only way "every selected service" and "every hidden payload" stay in sync.
  function clearAll() {
    setSelected({});
    setBulkPrice("");
    onError(null);
  }

  // Fast bulk price entry without fabricating a number: the owner types one real price and it
  // applies only to currently-selected drafts whose price is still blank — a price the owner
  // already typed into an individual row is never overwritten.
  function applyBulkPrice() {
    if (!priceIsValid(bulkPrice)) {
      onError("Enter a valid price to apply to all selected services.");
      return;
    }
    setSelected((current) => {
      const next = { ...current };
      for (const id of Object.keys(next)) {
        if (next[id].price.trim() === "") next[id] = { ...next[id], price: bulkPrice };
      }
      return next;
    });
    onError(null);
  }

  function updateDraft(id: string, patch: Partial<CatalogDraft>) {
    setSelected((current) => ({
      ...current,
      [id]: { ...current[id], ...patch },
    }));
  }

  async function addSelected() {
    const drafts = Object.values(selected);
    if (drafts.length === 0) return;
    // A blank price string must never silently submit as 0 — Number("") is 0, which is otherwise
    // indistinguishable from an owner deliberately entering a free/complementary service (the
    // platform's schema itself allows price 0). priceIsValid requires a real, non-blank entry.
    const invalid = drafts.find((draft) => {
      const minutes = Number(draft.durationMinutes);
      return !priceIsValid(draft.price) || !Number.isInteger(minutes) || minutes < 5 || minutes > 480;
    });
    if (invalid) {
      onError(`Enter a price and a duration from 5 to 480 minutes for ${invalid.item.name}.`);
      return;
    }

    setSubmitting(true);
    onError(null);
    const created: SalonServiceDto[] = [];
    try {
      for (const draft of drafts) {
        created.push(await apiFetch<SalonServiceDto>(basePath, {
          method: "POST",
          body: JSON.stringify({
            name: draft.item.name,
            description: draft.description.trim() || undefined,
            category: draft.item.category,
            price: Number(draft.price),
            durationMinutes: Number(draft.durationMinutes),
          }),
        }));
      }
      onCreated(created);
      setSelected({});
    } catch (error) {
      if (created.length > 0) onCreated(created);
      onError(error instanceof ApiError ? error.message : "Could not add all selected services.");
      setSelected((current) => {
        const next = { ...current };
        created.forEach((service) => {
          const catalogItem = SERVICE_CATALOG.find((candidate) =>
            normalizeServiceIdentity(candidate.name, candidate.category) ===
            normalizeServiceIdentity(service.name, service.category),
          );
          if (catalogItem) delete next[catalogItem.id];
        });
        return next;
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function reactivate(service: SalonServiceDto) {
    setReactivatingId(service.id);
    onError(null);
    try {
      const updated = await apiFetch<SalonServiceDto>(`${basePath}/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      });
      onReactivated(updated);
    } catch (error) {
      onError(error instanceof ApiError ? error.message : "Could not reactivate that service.");
    } finally {
      setReactivatingId(null);
    }
  }

  return (
    <section className={styles.catalogSection} aria-labelledby="service-catalog-heading">
      <div className={styles.catalogHeadingRow}>
        <div>
          <p className={styles.eyebrow}>Quick setup</p>
          <h2 id="service-catalog-heading" className={styles.sectionHeading}>Choose a service pack</h2>
          <p className={styles.hint}>Start with Basic, Standard or Advance services, then enter your own prices.</p>
        </div>
        <div className={styles.catalogHeadingActions}>
          <span className={styles.selectionCount}>{Object.keys(selected).length} selected</span>
          <Button
            type="button"
            variant="outline"
            onClick={() => (allSelected ? clearAll() : selectAll())}
            disabled={selectableCatalog.length === 0}
          >
            {allSelected ? "Clear pack selection" : `Select all in ${SERVICE_CATALOG_PACKS.find((item) => item.id === pack)?.label ?? "this pack"}`}
          </Button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10, marginBottom: 18 }}>
        {SERVICE_CATALOG_PACKS.map((packOption) => {
          const count = SERVICE_CATALOG.filter((item) => item.pack === packOption.id).length;
          const active = pack === packOption.id;
          return (
            <button
              key={packOption.id}
              type="button"
              onClick={() => {
                setPack(packOption.id);
                setCategory("all");
                setQuery("");
                onError(null);
              }}
              aria-pressed={active}
              style={{
                textAlign: "left",
                padding: 14,
                borderRadius: 14,
                border: active ? "2px solid var(--bc-accent)" : "1px solid var(--bc-border)",
                background: active ? "var(--bc-accent-soft)" : "var(--bc-surface)",
                color: "var(--bc-ink)",
                cursor: "pointer",
              }}
            >
              <strong style={{ display: "block", marginBottom: 4 }}>{packOption.label}</strong>
              <span style={{ display: "block", fontSize: 12, color: "var(--bc-muted)", lineHeight: 1.45 }}>
                {packOption.description}
              </span>
              <span style={{ display: "block", marginTop: 6, fontSize: 12, fontWeight: 700 }}>
                {count} services
              </span>
            </button>
          );
        })}
      </div>

      <div className={styles.catalogFilters}>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="catalog-search">Search services</label>
          <input
            id="catalog-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Fade, facial, manicure…"
            className={styles.input}
          />
        </div>
        <div className={styles.fieldWrap}>
          <label className={styles.fieldLabel} htmlFor="catalog-category">Category</label>
          <select
            id="catalog-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className={styles.select}
          >
            <option value="all">All categories</option>
            {packCategories.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
      </div>

      <div className={styles.catalogGrid}>
        {visible.map((item) => {
          const identity = normalizeServiceIdentity(item.name, item.category);
          const existing = existingByIdentity.get(identity);
          const draft = selected[item.id];
          return (
            <article
              key={item.id}
              className={`${styles.catalogCard} ${draft ? styles.catalogCardSelected : ""}`}
            >
              <div className={styles.catalogCardTop}>
                <label className={styles.catalogChoice}>
                  <input
                    type="checkbox"
                    checked={Boolean(draft) || Boolean(existing?.isActive)}
                    disabled={Boolean(existing)}
                    onChange={() => toggle(item)}
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.category} · {item.defaultDurationMinutes} min suggested</small>
                  </span>
                </label>
                {existing?.isActive && <span className={styles.addedBadge}>Added</span>}
                {existing && !existing.isActive && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void reactivate(existing)}
                    disabled={reactivatingId === existing.id}
                  >
                    {reactivatingId === existing.id ? "Restoring…" : "Reactivate"}
                  </Button>
                )}
              </div>

              {draft && (
                <div className={styles.catalogDraftFields}>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`catalog-price-${item.id}`}>
                      Price{currencyLabel} (required)
                    </label>
                    <input
                      id={`catalog-price-${item.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={1_000_000}
                      required
                      aria-required="true"
                      value={draft.price}
                      onChange={(event) => updateDraft(item.id, { price: event.target.value })}
                      placeholder="Enter price"
                      className={styles.input}
                    />
                  </div>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`catalog-duration-${item.id}`}>Minutes</label>
                    <input
                      id={`catalog-duration-${item.id}`}
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={480}
                      step={5}
                      value={draft.durationMinutes}
                      onChange={(event) => updateDraft(item.id, { durationMinutes: event.target.value })}
                      className={styles.input}
                    />
                  </div>
                  <div className={`${styles.fieldWrap} ${styles.catalogDetailsField}`}>
                    <label className={styles.fieldLabel} htmlFor={`catalog-details-${item.id}`}>Details (optional)</label>
                    <input
                      id={`catalog-details-${item.id}`}
                      value={draft.description}
                      onChange={(event) => updateDraft(item.id, { description: event.target.value })}
                      maxLength={1000}
                      placeholder="What is included?"
                      className={styles.input}
                    />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {visible.length === 0 && <p className={styles.emptyState}>No services match that search.</p>}
      {Object.keys(selected).length > 1 && (
        <div className={styles.catalogBulkPriceBar}>
          <div className={styles.fieldWrap}>
            <label className={styles.fieldLabel} htmlFor="catalog-bulk-price">
              Apply one price to every selected service that doesn&apos;t have one yet{currencyLabel}
            </label>
            <input
              id="catalog-bulk-price"
              type="number"
              inputMode="decimal"
              min={0}
              max={1_000_000}
              value={bulkPrice}
              onChange={(event) => setBulkPrice(event.target.value)}
              placeholder="e.g. 300"
              className={styles.input}
            />
          </div>
          <Button type="button" variant="outline" onClick={applyBulkPrice}>
            Apply to all
          </Button>
        </div>
      )}
      {Object.keys(selected).length > 0 && (
        <div className={styles.catalogAddBar}>
          <span>{Object.keys(selected).length} service{Object.keys(selected).length === 1 ? "" : "s"} ready</span>
          <Button type="button" variant="secondary" onClick={() => void addSelected()} disabled={submitting}>
            {submitting ? "Adding services…" : "Add selected services"}
          </Button>
        </div>
      )}
    </section>
  );
}
