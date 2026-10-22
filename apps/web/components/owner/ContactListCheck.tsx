"use client";

import { useMemo, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { RecordContactConsentsResultDto, SalonContactImportPreviewDto, SalonContactImportPreviewInput } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  CONSENT_SOURCES,
  MAX_CONTACTS,
  buildRequest,
  isConsentSource,
  maskedPhone,
  parseContactList,
  statusText,
  todayIso,
  validateBatch,
  type BatchConsent,
  type ContactRow,
} from "../../lib/contact-preview";
import { ledgerPath, outcomeText, parseRecordResult, savedSentence } from "../../lib/contact-ledger";
import { Badge, Banner, Btn, Card, EmptyState, Field } from "./parts";
import ui from "./owner.module.css";

interface Result {
  rows: ContactRow[];
  /** Exactly what was checked, so saving can never send something different. */
  body: SalonContactImportPreviewInput;
  preview: SalonContactImportPreviewDto;
}

/**
 * Contact list check: paste a list of phone numbers and see which lines FastQue can read and which are missing
 * agreement details. It is a check only. Nothing is saved, nobody is looked up, contacted or invited, and sending
 * invitations is not available. What is typed stays in this page's memory only and is gone when the owner clears it or
 * leaves.
 */
export function ContactListCheck({ salonId, ledgerEnabled = false }: { salonId: string; ledgerEnabled?: boolean }) {
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.contacts}/preview`;
  const [text, setText] = useState("");
  const [batch, setBatch] = useState<BatchConsent>({ attested: false, source: "OWNER_ATTESTED", date: todayIso() });
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<RecordContactConsentsResultDto | null>(null);

  const parsed = useMemo(() => parseContactList(text), [text]);
  const batchProblem = validateBatch(batch);
  const tooMany = parsed.rows.length > MAX_CONTACTS;

  async function check() {
    setError(null);
    setResult(null);
    setSaved(null);
    setSaveError(null);
    if (parsed.rows.length === 0) {
      setError("Add at least one phone number.");
      return;
    }
    if (tooMany) {
      setError(`Check at most ${MAX_CONTACTS} numbers at a time.`);
      return;
    }
    if (batchProblem) {
      setError(batchProblem);
      return;
    }
    setChecking(true);
    try {
      const body = buildRequest(parsed.rows, batch);
      const preview = await apiFetch<SalonContactImportPreviewDto>(path, { method: "POST", body: JSON.stringify(body) });
      if (!preview || !Array.isArray(preview.items) || preview.items.length !== parsed.rows.length) {
        setError("FastQue sent an answer this page could not match to your list, so nothing is shown.");
      } else {
        setResult({ rows: parsed.rows, body, preview });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) setError("You have checked a lot of lists in a short time. Wait a minute and try again.");
      else if (err instanceof ApiError && err.status === 404) setError("Checking contact lists is not available for your shop yet.");
      else setError(err instanceof ApiError ? err.message : "Could not check the list. Nothing was saved.");
    } finally {
      setChecking(false);
    }
  }

  function clearAll() {
    setText("");
    setResult(null);
    setError(null);
    setSaved(null);
    setSaveError(null);
  }

  async function save() {
    if (!result) return;
    setSaving(true);
    setSaveError(null);
    setSaved(null);
    try {
      const raw = await apiFetch<unknown>(ledgerPath(salonId), { method: "POST", body: JSON.stringify(result.body) });
      const parsedResult = parseRecordResult(raw, result.rows.length);
      if (!parsedResult) setSaveError("FastQue sent an answer this page could not match to your list, so nothing is assumed to be saved.");
      else setSaved(parsedResult);
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) setSaveError("Saving agreement records is not switched on for FastQue yet. Nothing was saved.");
      else if (err instanceof ApiError && err.status === 429) setSaveError("You have saved a lot of lists in a short time. Wait a minute and try again.");
      else setSaveError(err instanceof ApiError ? err.message : "Could not save the records. Nothing was assumed to be saved.");
    } finally {
      setSaving(false);
    }
  }

  const summary = result?.preview.summary;
  return (
    <div className={ui.mt16}>
      <Banner tone="info">
        {ledgerEnabled
          ? "Checking a list saves nothing. If you choose to save agreement records afterwards, FastQue keeps only a scrambled fingerprint of each number and when and how you say the person agreed, never the number itself. Nobody is contacted or invited, and sending invitations is not available yet. A person you list must have agreed to be contacted; what you state here is your own statement, not proof."
          : "This is a check only. FastQue does not save your list, does not look anyone up, and does not contact or invite anyone. Sending invitations is not available yet. A person you list must have agreed to be contacted; what you state here is your own statement, not proof."}
      </Banner>

      <div className={ui.mt16}>
        <Card title="Your list" sub={`One person per line: the phone number, and optionally how and when they agreed, like “98765 43210, IN_PERSON, 2026-09-30”. Up to ${MAX_CONTACTS} numbers at a time. Numbers without a +country code are read as Indian mobile numbers.`}>
          <Field label="Phone numbers" htmlFor="contacts-text">
            <textarea id="contacts-text" className={ui.input} rows={8} value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} spellCheck={false} autoComplete="off" />
          </Field>
          <p className={ui.cardSub} role="status">
            {parsed.rows.length} number{parsed.rows.length === 1 ? "" : "s"} read{parsed.problems.length > 0 ? `, ${parsed.problems.length} line${parsed.problems.length === 1 ? "" : "s"} with a problem` : ""}.
          </p>
          {parsed.problems.length > 0 && (
            <ul aria-label="Lines with a problem">
              {parsed.problems.slice(0, 20).map((p) => (
                <li key={p.line} className={ui.cardSub}>Line {p.line}: {p.message}</li>
              ))}
            </ul>
          )}
          {tooMany && <Banner tone="warn">That is more than {MAX_CONTACTS} numbers. Check them in smaller lists.</Banner>}

          <div className={ui.mt12}>
            <label className={ui.label}>
              <input id="contacts-attested" type="checkbox" checked={batch.attested} onChange={(e) => { setBatch({ ...batch, attested: e.target.checked }); setResult(null); }} />{" "}
              Everyone on this list has agreed to be contacted by my shop
            </label>
          </div>
          {batch.attested && (
            <div className={`${ui.rowWrap} ${ui.mt12}`}>
              <Field label="How they agreed" htmlFor="contacts-source">
                <select id="contacts-source" className={ui.input} value={batch.source} onChange={(e) => { if (isConsentSource(e.target.value)) setBatch({ ...batch, source: e.target.value }); setResult(null); }}>
                  {CONSENT_SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Date they agreed" htmlFor="contacts-date" hint={batchProblem ?? undefined}>
                <input id="contacts-date" type="date" className={ui.input} value={batch.date} max={todayIso()} onChange={(e) => { setBatch({ ...batch, date: e.target.value }); setResult(null); }} aria-invalid={Boolean(batchProblem)} />
              </Field>
            </div>
          )}

          {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn variant="primary" onClick={() => void check()} disabled={checking}>{checking ? "Checking…" : "Check list"}</Btn>
            <Btn variant="quiet" onClick={clearAll} disabled={checking || (!text && !result)}>Clear list</Btn>
          </div>
        </Card>
      </div>

      {result && summary && (
        <div className={ui.mt16} aria-live="polite">
          <Card title="Result" sub="No invitation has been sent and none can be sent from here.">
            <div className={ui.statGrid}>
              <div className={ui.stat}><div className={ui.statLabel}>Checked</div><div className={ui.statValue}>{summary.total}</div></div>
              <div className={ui.stat}><div className={ui.statLabel}>Look complete</div><div className={ui.statValue}>{summary.validatedForReview}</div></div>
              <div className={ui.stat}><div className={ui.statLabel}>Not a valid number</div><div className={ui.statValue}>{summary.invalidPhone}</div></div>
              <div className={ui.stat}><div className={ui.statLabel}>No agreement stated</div><div className={ui.statValue}>{summary.consentRequired}</div></div>
              <div className={ui.stat}><div className={ui.statLabel}>Details missing</div><div className={ui.statValue}>{summary.consentEvidenceIncomplete + summary.consentTimestampInvalid}</div></div>
              <div className={ui.stat}><div className={ui.statLabel}>Repeated</div><div className={ui.statValue}>{summary.duplicateInBatch}</div></div>
            </div>
            {summary.total === 0 ? (
              <EmptyState title="Nothing to show" />
            ) : (
              <div className={ui.tableWrap}>
                <table className={ui.table}>
                  <caption className={ui.cardSub}>One row per line of your list</caption>
                  <thead><tr><th>Line</th><th>Number</th><th>Result</th><th>What to do</th></tr></thead>
                  <tbody>
                    {result.preview.items.map((item) => {
                      const row = result.rows[item.index];
                      const status = statusText(item.status);
                      return (
                        <tr key={item.index}>
                          <td>{row?.line ?? "—"}</td>
                          <td>{row ? maskedPhone(row.phone) : "—"}</td>
                          <td><Badge tone={status.ok ? "ok" : "warn"}>{status.label}</Badge></td>
                          <td className={ui.cardSub}>{status.help}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {ledgerEnabled && result && summary && summary.validatedForReview > 0 && (
        <div className={ui.mt16} aria-live="polite">
          <Card title="Save agreement records" sub="Optional. This keeps a record that these people agreed, so you can show it later and so a person who asks you to stop can be respected. It does not send anything.">
            {saveError && <Banner tone="error">{saveError}</Banner>}
            {saved && (
              <>
                <Banner tone="info">{savedSentence(saved)}</Banner>
                <div className={ui.tableWrap}>
                  <table className={ui.table}>
                    <caption className={ui.cardSub}>One row per line of your list</caption>
                    <thead><tr><th>Line</th><th>Number</th><th>Result</th></tr></thead>
                    <tbody>
                      {saved.items.map((item) => {
                        const row = result.rows[item.index];
                        const outcome = outcomeText(item.outcome);
                        return (
                          <tr key={item.index}>
                            <td>{row?.line ?? "—"}</td>
                            <td>{row ? maskedPhone(row.phone) : "—"}</td>
                            <td><Badge tone={outcome.ok ? "ok" : "warn"}>{outcome.label}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            <div className={`${ui.rowWrap} ${ui.mt12}`}>
              <Btn variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "Saving…" : saved ? "Save again" : "Save agreement records"}</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
