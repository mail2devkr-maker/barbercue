"use client";

import { useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  LANGUAGES,
  LIMITS,
  TONES,
  buildRequest,
  describeFailure,
  describeLength,
  isLanguage,
  isTone,
  parseHighlights,
  parseSuggestion,
  type DraftLanguage,
  type DraftTone,
  type Failure,
} from "../../lib/description-assistant";
import { Button } from "../ui/Button";
import styles from "./dashboard.module.css";

const fieldStyle = { width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--bc-border)", background: "var(--bc-surface)", color: "var(--bc-ink)", font: "inherit" } as const;

/**
 * "Write a draft with AI" for the shop description. It only ever produces text for the owner to read and edit: nothing is
 * saved here, and nothing reaches the shop's profile until the owner presses "Use this draft" (which fills the description
 * box above) and then saves the profile as usual. While the server has no writing service configured it says so plainly
 * and shows no draft. Writing the description by hand is never affected.
 */
export function DescriptionAssistant({ salonId, onUse }: { salonId: string; onUse: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<DraftLanguage>("en");
  const [tone, setTone] = useState<DraftTone>("professional");
  const [facts, setFacts] = useState("");
  const [factsError, setFactsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [used, setUsed] = useState(false);

  const edited = draft !== null && generated !== null && draft !== generated;
  const unavailable = failure?.kind === "UNAVAILABLE";

  async function generate() {
    setFactsError(null);
    setFailure(null);
    setConfirmReplace(false);
    setUsed(false);
    const { highlights, error } = parseHighlights(facts);
    if (error) {
      setFactsError(error);
      return;
    }
    setBusy(true);
    try {
      const raw = await apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/description/suggestions`, {
        method: "POST",
        body: JSON.stringify(buildRequest(language, tone, highlights)),
      });
      const suggestion = parseSuggestion(raw);
      if (!suggestion) {
        setFailure({ kind: "TRY_LATER", message: "A draft could not be produced this time. Nothing was changed. Try again, or write your description yourself." });
        return;
      }
      setDraft(suggestion.draft);
      setGenerated(suggestion.draft);
      setNotice(suggestion.notice);
    } catch (err) {
      // No draft is invented for a failure; any earlier draft stays as it was.
      setFailure(err instanceof ApiError ? describeFailure(err.status, err.code, err.message) : { kind: "TRY_LATER", message: "Could not reach the server. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  function regenerate() {
    if (edited && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    void generate();
  }

  function use() {
    if (draft === null) return;
    onUse(draft.trim());
    setUsed(true);
  }

  function discard() {
    setDraft(null);
    setGenerated(null);
    setNotice(null);
    setConfirmReplace(false);
    setUsed(false);
  }

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>Write a draft with AI</Button>
        <p style={{ color: "var(--bc-muted)", fontSize: 12, margin: "6px 0 0" }}>Optional. You can always write your own description in the box above.</p>
      </div>
    );
  }

  const length = draft !== null ? describeLength(draft) : null;
  return (
    <section aria-label="Write a description draft with AI" className={styles.dividerSection} style={{ marginTop: 4 }}>
      <h3 className={styles.sectionHeading}>Write a draft with AI</h3>
      <p style={{ color: "var(--bc-muted)", fontSize: 13, margin: "0 0 10px" }}>
        The draft uses your shop&apos;s name, city and services. It is only a suggestion: read it, change it, and nothing is saved until you press Save profile.
      </p>

      {unavailable ? (
        <p className={`${styles.banner} ${styles.bannerWarning}`} role="status">{failure.message}</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <label>
              <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Language</span>
              <select id="draft-language" value={language} onChange={(e) => isLanguage(e.target.value) && setLanguage(e.target.value)} style={fieldStyle}>
                {LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Tone</span>
              <select id="draft-tone" value={tone} onChange={(e) => isTone(e.target.value) && setTone(e.target.value)} style={fieldStyle}>
                {TONES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Facts to include (optional, one per line, up to {LIMITS.maxHighlights})</span>
            <textarea id="draft-facts" rows={3} value={facts} onChange={(e) => setFacts(e.target.value)} placeholder="Open since 2012&#10;Wedding packages" style={fieldStyle} />
            <span style={{ display: "block", fontSize: 12, color: "var(--bc-muted)", marginTop: 4 }}>Only write things that are true. You are responsible for what your description says.</span>
          </label>
          {factsError && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{factsError}</p>}
          {failure && !unavailable && <p className={`${styles.banner} ${styles.bannerError}`} role="alert">{failure.message}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {draft === null && <Button type="button" variant="secondary" onClick={() => void generate()} disabled={busy}>{busy ? "Writing…" : "Write a draft"}</Button>}
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Close</Button>
          </div>
        </div>
      )}

      {draft !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }} aria-busy={busy}>
          <label>
            <span style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Draft (you can edit it)</span>
            <textarea id="draft-text" rows={6} value={draft} onChange={(e) => { setDraft(e.target.value); setUsed(false); }} style={fieldStyle} />
          </label>
          {length && <p style={{ fontSize: 12, margin: 0, color: length.state === "ok" ? "var(--bc-muted)" : "var(--bc-warning, var(--bc-muted))" }}>{length.message}</p>}
          {notice && <p style={{ fontSize: 12, margin: 0, color: "var(--bc-muted)" }}>{notice}</p>}
          {confirmReplace && <p className={`${styles.banner} ${styles.bannerWarning}`} role="alert">Getting a new draft replaces your edits to this one. Press “Replace my edits” to continue.</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button type="button" variant="secondary" onClick={use}>Use this draft</Button>
            <Button type="button" variant="outline" onClick={regenerate} disabled={busy || unavailable}>{busy ? "Writing…" : confirmReplace ? "Replace my edits" : "Write another draft"}</Button>
            <Button type="button" variant="outline" onClick={discard} disabled={busy}>Discard</Button>
          </div>
          {used && <p role="status" style={{ color: "var(--bc-success)", fontSize: 13, margin: 0 }}>The draft is now in the description box above. Check it, then press Save profile. Nothing has been saved yet.</p>}
        </div>
      )}
    </section>
  );
}
