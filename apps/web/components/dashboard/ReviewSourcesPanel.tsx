"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { ReviewSource, ReviewSourceDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  PROVIDERS,
  SOURCE_ORDER,
  buildProfileUpdate,
  externalSourceNote,
  formFromSources,
  parseSources,
  reviewProfileErrorText,
  sourceLabel,
  stateText,
  type ProfileErrors,
  type ProfileForm,
} from "../../lib/review-profiles";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

/** Which review source is shown. Only FastQue has reviews; the others are links the owner added. */
export function ReviewSourceTabs({ sources, value, onChange }: { sources: ReviewSourceDto[]; value: ReviewSource; onChange: (source: ReviewSource) => void }) {
  return (
    <div role="tablist" aria-label="Review source" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
      {SOURCE_ORDER.map((source) => {
        const info = sources.find((s) => s.source === source);
        return (
          <button
            key={source}
            type="button"
            role="tab"
            aria-selected={value === source}
            onClick={() => onChange(source)}
            style={{
              padding: "6px 14px",
              borderRadius: 999,
              border: "1px solid var(--bc-border)",
              background: value === source ? "var(--bc-accent)" : "var(--bc-surface)",
              color: value === source ? "var(--bc-on-accent, #fff)" : "var(--bc-ink)",
              cursor: "pointer",
            }}
          >
            {sourceLabel(source)}
            {info && source !== "FASTQUE" && <span className={styles.rowMeta}> · {stateText(info.state)}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** What an outside source shows: its explanation and, when the owner added one, a link out. Never fetched reviews. */
export function ExternalSourceView({ source, sources }: { source: Exclude<ReviewSource, "FASTQUE">; sources: ReviewSourceDto[] }) {
  const label = sourceLabel(source);
  const url = sources.find((s) => s.source === source)?.profileUrl ?? null;
  return (
    <div className={styles.emptyState}>
      <p>{externalSourceNote(label, url !== null)}</p>
      {url && (
        <p>
          <a href={url} target="_blank" rel="noopener noreferrer nofollow">Open your {label} page</a> (opens in a new tab)
        </p>
      )}
    </div>
  );
}

/**
 * The shop's outside review-profile links. Saving sends only the links that changed; an emptied box removes that link. Nothing is
 * fetched from those sites, and a link is not proof that the page belongs to the shop.
 */
export function ReviewProfileLinks({ salonId, sources, onSaved }: { salonId: string; sources: ReviewSourceDto[]; onSaved: (sources: ReviewSourceDto[]) => void }) {
  const [form, setForm] = useState<ProfileForm>(() => formFromSources(sources));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reload the boxes when the saved links change (for example after a save).
  const savedKey = JSON.stringify(formFromSources(sources));
  useEffect(() => {
    void Promise.resolve().then(() => setForm(JSON.parse(savedKey) as ProfileForm));
  }, [savedKey]);

  async function save() {
    setError(null);
    setNotice(null);
    const { body, errors: found } = buildProfileUpdate(sources, form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!body) {
      setNotice("Nothing changed.");
      return;
    }
    setSaving(true);
    try {
      const result = await apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/review-profiles`, { method: "PUT", body: JSON.stringify(body) });
      const next = parseSources((result as { sources?: unknown } | null)?.sources);
      if (next) onSaved(next);
      setNotice("Links saved.");
    } catch (err) {
      setError(err instanceof ApiError ? reviewProfileErrorText(err.code, err.message) : "Could not save the links. Nothing was changed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Review profile links" style={{ margin: "20px 0" }}>
      <h2 className={styles.sectionHeading}>Your review profile links</h2>
      <p className={styles.rowMeta}>
        Add the links to your shop&apos;s pages on other sites so you can open them from here. FastQue does not read or count reviews from those
        sites, and adding a link does not prove the page belongs to your shop.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        {PROVIDERS.map((info) => (
          <div key={info.field} style={{ margin: "8px 0" }}>
            <label className={styles.fieldLabel} htmlFor={`profile-${info.field}`}>{info.label} link</label>
            <input
              id={`profile-${info.field}`}
              className={styles.input}
              type="url"
              inputMode="url"
              value={form[info.field]}
              onChange={(e) => { const value = e.target.value; setForm((f) => ({ ...f, [info.field]: value })); }}
              placeholder={info.example}
              maxLength={500}
              autoComplete="off"
              aria-invalid={errors[info.field] ? true : undefined}
              aria-describedby={errors[info.field] ? `profile-${info.field}-error` : undefined}
            />
            {errors[info.field] && <span id={`profile-${info.field}-error`} className={styles.rowMeta} role="alert">{errors[info.field]}</span>}
          </div>
        ))}
        {error && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{error}</p>}
        <div role="status" aria-live="polite">{notice && <p className={`${styles.banner} ${styles.bannerNotice}`}>{notice}</p>}</div>
        <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save links"}</Button>
      </form>
    </section>
  );
}
