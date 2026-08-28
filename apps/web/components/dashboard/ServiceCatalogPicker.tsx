"use client";

import { useMemo, useState } from "react";
import {
  SERVICE_CATALOG,
  SERVICE_CATALOG_CATEGORIES,
  normalizeServiceIdentity,
  type SalonServiceDto,
  type ServiceCatalogItem,
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
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<Record<string, CatalogDraft>>({});
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
      (category === "all" || catalogItem.category === category) &&
      (!search || `${catalogItem.name} ${catalogItem.category}`.toLowerCase().includes(search)),
    );
  }, [category, query]);

  function toggle(item: ServiceCatalogItem) {
    const existing = existingByIdentity.get(normalizeServiceIdentity(item.name, item.category));
    if (existing) return;
    setSelected((current) => {
      if (current[item.id]) {
        const next = { ...current };
        delete next[item.id];
        return next;
      }
      return {
        ...current,
        [item.id]: {
          item,
          price: "",
          durationMinutes: String(item.defaultDurationMinutes),
          description: "",
        },
      };
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
    const invalid = drafts.find((draft) => {
      const price = Number(draft.price);
      const minutes = Number(draft.durationMinutes);
      return !Number.isFinite(price) || price < 0 || !Number.isInteger(minutes) || minutes < 5 || minutes > 480;
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
          <h2 id="service-catalog-heading" className={styles.sectionHeading}>Choose common services</h2>
          <p className={styles.hint}>Select what you offer, then enter your own prices.</p>
        </div>
        <span className={styles.selectionCount}>{Object.keys(selected).length} selected</span>
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
            {SERVICE_CATALOG_CATEGORIES.map((name) => <option key={name} value={name}>{name}</option>)}
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
                      Price{currencyLabel}
                    </label>
                    <input
                      id={`catalog-price-${item.id}`}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={1_000_000}
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
