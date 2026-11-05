"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DASHBOARD_PATHS, Role, formatMoney } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { useAssistantRefresh } from "../../../../../../lib/assistant-events";
import { RequireRole } from "../../../../../../components/auth/RequireRole";
import { CatalogImportPanel } from "../../../../../../components/dashboard/CatalogImportPanel";
import { RemoveAllServicesControl } from "../../../../../../components/dashboard/RemoveAllServicesControl";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import { ServiceFilterBar } from "../../../../../../components/dashboard/ServiceFilterBar";
import { ServiceTaxonomyPicker } from "../../../../../../components/dashboard/ServiceTaxonomyPicker";
import { Button } from "../../../../../../components/ui/Button";
import { filterServices, groupForDisplay, listCategories } from "../../../../../../lib/service-categories";
import {
  EMPTY_CHOICE,
  categoryLine,
  choiceFromService,
  choiceProblem,
  parseServiceTree,
  sortedTree,
  taxonomyFields,
  type ServiceTree,
  type TaxonomyChoice,
} from "../../../../../../lib/service-taxonomy";
import styles from "../../../../../../components/dashboard/dashboard.module.css";
import filterStyles from "../../../../../../components/dashboard/service-filter.module.css";

const MAX_PRICE = 1_000_000;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

interface Draft {
  name: string;
  description: string;
  taxonomy: TaxonomyChoice;
  price: string;
  durationMinutes: string;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  taxonomy: EMPTY_CHOICE,
  price: "",
  durationMinutes: "30",
};

function validate(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the service a name, like “Haircut”.";
  const categoryProblem = choiceProblem(draft.taxonomy);
  if (categoryProblem) return categoryProblem;
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) return "Enter a price, like 300.";
  if (price > MAX_PRICE) return "That price looks too high — please check it.";
  const minutes = Number(draft.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return `Enter a duration between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`;
  }
  return null;
}

function payloadFor(draft: Draft, mode: "create" | "update") {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    ...taxonomyFields(draft.taxonomy, mode),
    price: Number(draft.price),
    durationMinutes: Number(draft.durationMinutes),
  };
}

export default function DashboardServicesPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.services}`;
  const [services, setServices] = useState<SalonServiceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showInactive, setShowInactive] = useState(false);
  // The shop's category tree; null when the server has none (an older backend), which keeps the plain category text box.
  const [tree, setTree] = useState<ServiceTree | null>(null);

  const refreshTree = useCallback(async () => {
    try {
      const parsed = parseServiceTree(await apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/service-categories`));
      setTree(parsed ? sortedTree(parsed) : null);
    } catch {
      setTree(null);
    }
  }, [salonId]);

  useEffect(() => {
    void Promise.resolve().then(refreshTree);
  }, [refreshTree]);
  const [serviceSearch, setServiceSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  // Category chips, search and grouping only change how the list is shown, never the services themselves.
  const categoryOptions = services ? listCategories(services, showInactive) : [];
  const activeCategory = categoryFilter !== null && categoryOptions.some((c) => c.key === categoryFilter) ? categoryFilter : null;
  const visibleTotal = services ? filterServices(services, { search: "", categoryKey: null, includeInactive: showInactive }).length : 0;
  const listEntries = services ? groupForDisplay(filterServices(services, { search: serviceSearch, categoryKey: activeCategory, includeInactive: showInactive })) : [];
  const shownCount = listEntries.filter((entry) => entry.kind === "service").length;

  const activeCount = services?.filter((service) => service.isActive).length ?? 0;
  const inactiveCount = services?.filter((service) => !service.isActive).length ?? 0;
  const salonCurrency = services?.find((service) => service.currency)?.currency ?? null;
  const currencyLabel = salonCurrency ? ` (${salonCurrency})` : "";

  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonServiceDto[]>(base)
      .then((list) => {
        if (!cancelled) setServices(list);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof ApiError ? fetchError.message : "Could not load services.");
      });
    return () => { cancelled = true; };
  }, [base]);

  // A change confirmed through the Assistant reloads the list from the server.
  useAssistantRefresh("services", () => {
    apiFetch<SalonServiceDto[]>(base).then(setServices).catch(() => undefined);
  });

  function replaceService(updated: SalonServiceDto) {
    setServices((current) => (current ?? []).map((service) =>
      service.id === updated.id ? updated : service,
    ));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const created = await apiFetch<SalonServiceDto>(base, {
        method: "POST",
        body: JSON.stringify(payloadFor(draft, "create")),
      });
      setServices((current) => [...(current ?? []), created]);
      void refreshTree();
      setDraft(EMPTY_DRAFT);
      setNotice(`${created.name} added.`);
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.message : "Could not add that service.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(service: SalonServiceDto) {
    setError(null);
    setNotice(null);
    setEditingId(service.id);
    setEditDraft({
      name: service.name,
      description: service.description ?? "",
      taxonomy: choiceFromService(service, tree),
      price: String(service.price),
      durationMinutes: String(service.durationMinutes),
    });
  }

  async function saveEdit(service: SalonServiceDto) {
    const problem = validate(editDraft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<SalonServiceDto>(`${base}/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...payloadFor(editDraft, "update"),
          description: editDraft.description.trim() || null,
        }),
      });
      replaceService(updated);
      void refreshTree();
      setEditingId(null);
      setNotice(`${updated.name} saved.`);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save that service.");
    }
  }

  async function toggleActive(service: SalonServiceDto) {
    setError(null);
    setNotice(null);
    try {
      const updated = await apiFetch<SalonServiceDto>(`${base}/${service.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !service.isActive }),
      });
      replaceService(updated);
      setNotice(updated.isActive ? `${updated.name} reactivated.` : `${updated.name} turned off. Past bookings are unchanged.`);
    } catch (toggleError) {
      setError(toggleError instanceof ApiError ? toggleError.message : "Could not update that service.");
    }
  }

  return (
    <RequireRole roles={[Role.SALON_OWNER, Role.PLATFORM_ADMIN, Role.CO_FOUNDER]} redirectTo="/dashboard/salons">
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>Services</h1>
      <p className={styles.rowMeta}>
        <Link href={`/dashboard/salons/${salonId}/services/categories`}>Manage categories and subcategories</Link>
      </p>
      <p className={styles.pageSubtitle}>
        Add the services your shop offers, with your own names, prices, durations and categories.
        Turning one off keeps every past booking and visit intact while removing it from future booking
        and queue choices.
      </p>
      <SetupNavigation salonId={salonId} currentStep="services" section="steps" />

      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{notice}</p>}
      {services === null && !error && <p className={styles.loadingText}>Loading services…</p>}

      <section aria-labelledby="custom-service-heading">
        <h2 id="custom-service-heading" className={styles.sectionHeading}>Add a service</h2>
        <form onSubmit={handleCreate} className={styles.form}>
          <div className={styles.fieldWrap} style={{ flex: "2 1 210px" }}>
            <label className={styles.fieldLabel} htmlFor="svc-name">Service name</label>
            <input id="svc-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={120} className={styles.input} placeholder="Classic Haircut" />
          </div>
          <div className={styles.fieldWrap} style={{ flex: "1 1 180px" }}>
            <ServiceTaxonomyPicker tree={tree} value={draft.taxonomy} onChange={(taxonomy) => setDraft((current) => ({ ...current, taxonomy }))} idPrefix="svc" />
          </div>
          <div className={styles.fieldWrap} style={{ flex: "1 1 120px" }}>
            <label className={styles.fieldLabel} htmlFor="svc-price">Price{currencyLabel}</label>
            <input id="svc-price" type="number" inputMode="decimal" min={0} max={MAX_PRICE} value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} required className={styles.input} placeholder="300" />
          </div>
          <div className={styles.fieldWrap} style={{ flex: "1 1 110px" }}>
            <label className={styles.fieldLabel} htmlFor="svc-minutes">Minutes</label>
            <input id="svc-minutes" type="number" inputMode="numeric" min={MIN_MINUTES} max={MAX_MINUTES} step={5} value={draft.durationMinutes} onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: event.target.value }))} required className={styles.input} />
          </div>
          <div className={styles.fieldWrap} style={{ flex: "1 1 100%" }}>
            <label className={styles.fieldLabel} htmlFor="svc-description">Service details (optional)</label>
            <textarea id="svc-description" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={1000} className={styles.textarea} rows={3} placeholder="What is included, preparation notes, or finish details" />
          </div>
          <Button type="submit" variant="secondary" disabled={submitting}>{submitting ? "Adding…" : "Add custom service"}</Button>
        </form>
      </section>

      {services && (
        <CatalogImportPanel
          basePath={base}
          existingServices={services}
          onImported={async () => { setServices(await apiFetch<SalonServiceDto[]>(base)); }}
        />
      )}

      <section aria-labelledby="existing-services-heading">
        <h2 id="existing-services-heading" className={styles.sectionHeading}>Your services</h2>
        {services && (
          <RemoveAllServicesControl
            key={salonId + ":" + services.length}
            basePath={base}
            activeCount={activeCount}
            totalCount={services.length}
            onRemoved={async (removedCount) => {
              const refreshed = await apiFetch<SalonServiceDto[]>(base);
              setServices(refreshed);
              setEditingId(null);
              setShowInactive(false);
              setNotice(removedCount + " services permanently removed. You can now import a fresh catalog.");
              setError(null);
            }}
          />
        )}
        {activeCount === 0 && services && <p className={styles.emptyState}>
          No active services yet. Add your first service above.
        </p>}
        {inactiveCount > 0 && (
          <Button type="button" variant="outline"
            onClick={() => setShowInactive((current) => !current)}>
            {showInactive ? "Hide" : "Show"} turned-off services ({inactiveCount})
          </Button>
        )}
        {services && (activeCount > 0 || showInactive) && (
          <ServiceFilterBar
            categories={categoryOptions}
            visibleTotal={visibleTotal}
            shownCount={shownCount}
            search={serviceSearch}
            onSearchChange={setServiceSearch}
            selectedCategory={activeCategory}
            onCategoryChange={setCategoryFilter}
          />
        )}
        {services && (activeCount > 0 || showInactive) && shownCount === 0 && (
          <p className={styles.emptyState}>No service matches this search or category.</p>
        )}
        {services && (activeCount > 0 || showInactive) && shownCount > 0 && (
          <ul className={styles.rowList}>
            {listEntries.map((entry) => {
              if (entry.kind === "heading") {
                return (
                  <li key={`heading-${entry.key || "none"}`} className={filterStyles.groupHeading}>
                    <span>{entry.label}</span>
                    <span className={filterStyles.groupCount}>{entry.count}</span>
                  </li>
                );
              }
              const service = entry.service;
              return editingId === service.id ? (
              <li key={service.id} className={styles.row} style={{ display: "block" }}>
                <div className={styles.editGrid}>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-name-${service.id}`}>Service name</label>
                    <input id={`edit-name-${service.id}`} value={editDraft.name} onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} className={styles.input} />
                  </div>
                  <div className={styles.fieldWrap}>
                    <ServiceTaxonomyPicker tree={tree} value={editDraft.taxonomy} onChange={(taxonomy) => setEditDraft((current) => ({ ...current, taxonomy }))} idPrefix={`edit-${service.id}`} />
                  </div>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-price-${service.id}`}>Price{currencyLabel}</label>
                    <input id={`edit-price-${service.id}`} type="number" inputMode="decimal" min={0} max={MAX_PRICE} value={editDraft.price} onChange={(event) => setEditDraft((current) => ({ ...current, price: event.target.value }))} className={styles.input} />
                  </div>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-minutes-${service.id}`}>Minutes</label>
                    <input id={`edit-minutes-${service.id}`} type="number" inputMode="numeric" min={MIN_MINUTES} max={MAX_MINUTES} step={5} value={editDraft.durationMinutes} onChange={(event) => setEditDraft((current) => ({ ...current, durationMinutes: event.target.value }))} className={styles.input} />
                  </div>
                  <div className={`${styles.fieldWrap} ${styles.editDetailsField}`}>
                    <label className={styles.fieldLabel} htmlFor={`edit-description-${service.id}`}>Service details</label>
                    <textarea id={`edit-description-${service.id}`} value={editDraft.description} onChange={(event) => setEditDraft((current) => ({ ...current, description: event.target.value }))} maxLength={1000} className={styles.textarea} rows={3} />
                  </div>
                </div>
                <div className={styles.rowActions}>
                  <Button type="button" variant="secondary" onClick={() => void saveEdit(service)}>Save changes</Button>
                  <Button type="button" variant="outline" onClick={() => setEditingId(null)}>Cancel</Button>
                </div>
              </li>
            ) : (
              <li key={service.id} className={styles.row}>
                <div style={{ minWidth: 0 }}>
                  <span className={styles.rowTitle} style={{ opacity: service.isActive ? 1 : 0.55 }}>{service.name}</span>
                  <div className={styles.rowMeta}>
                    {categoryLine(service) ? `${categoryLine(service)} · ` : ""}{formatMoney(service.price, service.currency)} · {service.durationMinutes} min{!service.isActive && " · turned off"}
                  </div>
                  {service.description && <p className={styles.rowDescription}>{service.description}</p>}
                </div>
                <div className={styles.rowActions}>
                  <Button type="button" variant="outline" onClick={() => startEdit(service)}>Edit</Button>
                  <Button type="button" variant="outline" onClick={() => void toggleActive(service)}>{service.isActive ? "Turn off" : "Reactivate"}</Button>
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </section>

      <SetupNavigation
        salonId={salonId}
        currentStep="services"
        section="actions"
        nextAction={{ kind: "link", href: `/dashboard/salons/${salonId}/photos`, label: "Next →" }}
      />
    </main>
    </RequireRole>
  );
}
