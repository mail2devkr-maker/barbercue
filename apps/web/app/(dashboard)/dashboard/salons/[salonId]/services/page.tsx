"use client";

import { use, useEffect, useState } from "react";
import { DASHBOARD_PATHS, formatMoney } from "@barbercue/shared";
import type { SalonServiceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { ServiceCatalogPicker } from "../../../../../../components/dashboard/ServiceCatalogPicker";
import { SetupNavigation } from "../../../../../../components/dashboard/SetupNavigation";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

const MAX_PRICE = 1_000_000;
const MIN_MINUTES = 5;
const MAX_MINUTES = 480;

interface Draft {
  name: string;
  description: string;
  category: string;
  price: string;
  durationMinutes: string;
}

const EMPTY_DRAFT: Draft = {
  name: "",
  description: "",
  category: "",
  price: "",
  durationMinutes: "30",
};

function validate(draft: Draft): string | null {
  if (!draft.name.trim()) return "Give the service a name, like “Haircut”.";
  const price = Number(draft.price);
  if (!Number.isFinite(price) || price < 0) return "Enter a price, like 300.";
  if (price > MAX_PRICE) return "That price looks too high — please check it.";
  const minutes = Number(draft.durationMinutes);
  if (!Number.isInteger(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
    return `Enter a duration between ${MIN_MINUTES} and ${MAX_MINUTES} minutes.`;
  }
  return null;
}

function payloadFor(draft: Draft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim() || undefined,
    category: draft.category.trim() || undefined,
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
        body: JSON.stringify(payloadFor(draft)),
      });
      setServices((current) => [...(current ?? []), created]);
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
      category: service.category ?? "",
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
          ...payloadFor(editDraft),
          description: editDraft.description.trim() || null,
          category: editDraft.category.trim() || null,
        }),
      });
      replaceService(updated);
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
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>Services</h1>
      <p className={styles.pageSubtitle}>
        Choose common services or add your own. Turning one off keeps every past booking and visit
        intact while removing it from future booking and queue choices.
      </p>
      <SetupNavigation salonId={salonId} currentStep="services" section="steps" />

      {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
      {notice && <p className={`${styles.banner} ${styles.bannerNotice}`} role="status">{notice}</p>}
      {services === null && <p className={styles.loadingText}>Loading services…</p>}

      {services && (
        <ServiceCatalogPicker
          basePath={base}
          services={services}
          currencyLabel={currencyLabel}
          onCreated={(created) => {
            setServices((current) => [...(current ?? []), ...created]);
            setNotice(`${created.length} service${created.length === 1 ? "" : "s"} added.`);
          }}
          onReactivated={(updated) => {
            replaceService(updated);
            setNotice(`${updated.name} reactivated.`);
          }}
          onError={setError}
        />
      )}

      <section aria-labelledby="custom-service-heading">
        <p className={styles.eyebrow}>Anything else</p>
        <h2 id="custom-service-heading" className={styles.sectionHeading}>Add custom service</h2>
        <form onSubmit={handleCreate} className={styles.form}>
          <div className={styles.fieldWrap} style={{ flex: "2 1 210px" }}>
            <label className={styles.fieldLabel} htmlFor="svc-name">Service name</label>
            <input id="svc-name" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={120} className={styles.input} placeholder="Classic Haircut" />
          </div>
          <div className={styles.fieldWrap} style={{ flex: "1 1 180px" }}>
            <label className={styles.fieldLabel} htmlFor="svc-category">Category (optional)</label>
            <input id="svc-category" value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} maxLength={60} className={styles.input} placeholder="Men's Hair & Grooming" />
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

      <section aria-labelledby="existing-services-heading">
        <h2 id="existing-services-heading" className={styles.sectionHeading}>Your services</h2>
        {services?.length === 0 && <p className={styles.emptyState}>No services yet. Choose presets or add a custom service above.</p>}
        {services && services.length > 0 && (
          <ul className={styles.rowList}>
            {services.map((service) => editingId === service.id ? (
              <li key={service.id} className={styles.row} style={{ display: "block" }}>
                <div className={styles.editGrid}>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-name-${service.id}`}>Service name</label>
                    <input id={`edit-name-${service.id}`} value={editDraft.name} onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} maxLength={120} className={styles.input} />
                  </div>
                  <div className={styles.fieldWrap}>
                    <label className={styles.fieldLabel} htmlFor={`edit-category-${service.id}`}>Category</label>
                    <input id={`edit-category-${service.id}`} value={editDraft.category} onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))} maxLength={60} className={styles.input} />
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
                    {service.category ? `${service.category} · ` : ""}{formatMoney(service.price, service.currency)} · {service.durationMinutes} min{!service.isActive && " · turned off"}
                  </div>
                  {service.description && <p className={styles.rowDescription}>{service.description}</p>}
                </div>
                <div className={styles.rowActions}>
                  <Button type="button" variant="outline" onClick={() => startEdit(service)}>Edit</Button>
                  <Button type="button" variant="outline" onClick={() => void toggleActive(service)}>{service.isActive ? "Turn off" : "Reactivate"}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SetupNavigation salonId={salonId} currentStep="services" section="actions" />
    </main>
  );
}
