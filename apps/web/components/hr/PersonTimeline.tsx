"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure } from "../../lib/hr-register/errors";
import { formatDay, formatInstant } from "../../lib/hr-register/format";
import {
  EPISODE_STATUS_LABEL,
  allowedOfferTransitions,
  allowedPersonActions,
  latestOffer,
} from "../../lib/hr-register/lifecycle";
import { generateOfferPdf, type PdfOutcome } from "../../lib/hr-register/pdf";
import type {
  HrAuditEntry,
  HrOfferTransition,
  HrOfferVersion,
  HrPersonDetail,
  HrPersonSummary,
} from "../../lib/hr-register/types";
import { formatInr } from "../../app/(dashboard)/dashboard/admin/crm/offer-letter";
import { ExitForm, JoiningForm, NotJoinedForm, TransitionForm } from "./LifecycleForms";
import { Banner, CodeChip, EpisodeStatusBadge, Facts, LifecycleBadge, OfferStatusBadge } from "./parts";
import styles from "./hr-register.module.css";

type ActiveForm =
  | { kind: "transition"; offer: HrOfferVersion; to: HrOfferTransition }
  | { kind: "joining"; offer: HrOfferVersion; rejoin: boolean }
  | { kind: "notJoined"; offer: HrOfferVersion }
  | { kind: "exit"; episodeId: string }
  | null;

const TRANSITION_BUTTON: Record<HrOfferTransition, string> = {
  SENT: "Record as emailed",
  ACCEPTED: "Record acceptance",
  DECLINED: "Record decline",
  EXPIRED: "Record expiry",
};

function termsSummary(offer: HrOfferVersion): string {
  const { terms } = offer;
  const pay = `INR ${formatInr(terms.baseSalaryInr)} ${terms.salaryBasis === "monthly" ? "per month" : "per annum"}`;
  const policy =
    terms.salesTarget !== null && terms.incentiveBeyondTargetInr !== null
      ? `target ${terms.salesTarget} shops, INR ${formatInr(terms.incentiveBeyondTargetInr)} beyond target`
      : "standard incentive policy";
  return `${terms.role} · ${pay} · ${policy}`;
}

export type PersonTimelineProps = {
  api?: HrRegisterApi;
  personId: string;
  onChanged?: () => void;
  /** Start a re-offer or rehire for this person in the offer composer. */
  onStartOffer?: (person: HrPersonSummary) => void;
  onClose?: () => void;
  /** Hands the PDF bytes to the browser; replaced in tests. */
  deliverPdf?: (bytes: Uint8Array, filename: string) => void;
};

export default function PersonTimeline({ api = httpHrRegisterApi, personId, onChanged, onStartOffer, onClose, deliverPdf }: PersonTimelineProps) {
  const [person, setPerson] = useState<HrPersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<ActiveForm>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const pdfInFlight = useRef(false);

  const [audit, setAudit] = useState<HrAuditEntry[] | null>(null);
  const [auditCursor, setAuditCursor] = useState<string | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);

  // Manual refresh after an action. (The parent keys this component by person, so state starts fresh.)
  const load = useCallback(async () => {
    try {
      setPerson(await api.getPerson(personId));
      setError(null);
    } catch (failure) {
      setError(describeHrFailure(failure, "Could not load this employee record."));
    }
  }, [api, personId]);

  useEffect(() => {
    let live = true;
    api
      .getPerson(personId)
      .then((next) => {
        if (!live) return;
        setPerson(next);
        setError(null);
      })
      .catch((failure: unknown) => live && setError(describeHrFailure(failure, "Could not load this employee record.")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [api, personId]);

  function applyPerson(next: HrPersonDetail, message: string) {
    setPerson(next);
    setForm(null);
    setNotice(message);
    setAudit(null);
    onChanged?.();
  }

  async function loadAudit(more: boolean) {
    if (auditBusy) return;
    setAuditBusy(true);
    try {
      const page = await api.listAudit(personId, more ? auditCursor : null);
      setAudit((current) => (more && current ? [...current, ...page.items] : page.items));
      setAuditCursor(page.nextCursor);
    } catch (failure) {
      setError(describeHrFailure(failure, "Could not load the audit trail."));
    } finally {
      setAuditBusy(false);
    }
  }

  async function reprint(offer: HrOfferVersion) {
    if (!person || pdfInFlight.current) return;
    pdfInFlight.current = true;
    setPdfBusy(offer.id);
    setError(null);
    try {
      const contacts = await api.getLetterData(offer.id);
      const outcome: PdfOutcome = await generateOfferPdf({
        api,
        employeeCode: person.employeeCode,
        candidateName: person.fullName,
        offer,
        contacts,
        event: "REPRINTED",
        deliver: deliverPdf,
      });
      setNotice(
        outcome.recorded
          ? `${outcome.filename} downloaded and recorded in the PDF history.`
          : `${outcome.filename} downloaded, but the history entry could not be recorded.`,
      );
      setPerson(await api.getPerson(personId));
      setAudit(null);
    } catch (failure) {
      setError(describeHrFailure(failure, "Could not generate this version’s PDF."));
    } finally {
      pdfInFlight.current = false;
      setPdfBusy(null);
    }
  }

  if (loading && !person) return <p className={styles.muted}>Loading employee record…</p>;
  if (!person) return error ? <Banner kind="error">{error}</Banner> : null;

  const actions = allowedPersonActions(person);
  const latest = latestOffer(person.offers);
  const currentEpisode = person.episodes.find((episode) => episode.id === person.currentEpisode?.id) ?? null;
  const firstEpisode = person.episodes.find((episode) => episode.episodeNumber === 1) ?? null;
  const offersNewestFirst = [...person.offers].sort((a, b) => b.version - a.version);
  const episodesNewestFirst = [...person.episodes].sort((a, b) => b.episodeNumber - a.episodeNumber);

  return (
    <section className={styles.panel} aria-labelledby="hr-person-title" data-testid="person-timeline">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Employee record</p>
          <h2 id="hr-person-title">{person.fullName}</h2>
          <p className={styles.muted}>
            <CodeChip code={person.employeeCode} /> · <LifecycleBadge person={person} /> · permanent ID, never reissued
          </p>
        </div>
        {onClose && (
          <button type="button" className={styles.secondary} onClick={onClose}>Close</button>
        )}
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <Facts
        items={[
          ["Email", person.maskedEmail ?? "—"],
          ["Phone", person.maskedPhone ?? "—"],
          ["City", person.city ?? "—"],
          ["Reporting manager", person.reportingManager ? `${person.reportingManager.fullName} (${person.reportingManager.employeeCode})` : "—"],
          ["First offer", formatInstant(person.firstOfferIssuedAt)],
          ["Original joining", formatDay(firstEpisode?.joinedOn)],
          ["Current episode", currentEpisode ? `#${currentEpisode.episodeNumber} · ${EPISODE_STATUS_LABEL[currentEpisode.status]}` : "None yet"],
          ["Employee account", person.hasEmployeeAccount ? "Exists (kept across rehires)" : "Not created — offer stage only"],
        ]}
      />

      <div className={styles.actions} style={{ marginTop: 12 }}>
        {latest && actions.canRecordJoining && (
          <button type="button" className={styles.primary} onClick={() => setForm({ kind: "joining", offer: latest, rejoin: person.episodeCount > 1 || person.hasEmployeeAccount })}>
            {person.hasEmployeeAccount ? "Record rejoining" : "Record joining"}
          </button>
        )}
        {latest && actions.canRecordNotJoined && (
          <button type="button" className={styles.secondary} onClick={() => setForm({ kind: "notJoined", offer: latest })}>Record did not join</button>
        )}
        {currentEpisode && actions.canRecordExit && (
          <button type="button" className={styles.danger} onClick={() => setForm({ kind: "exit", episodeId: currentEpisode.id })}>Record exit</button>
        )}
        {onStartOffer && actions.canReoffer && (
          <button type="button" className={styles.primary} onClick={() => onStartOffer(person)}>Issue a new offer (same ID)</button>
        )}
        {onStartOffer && actions.canRehire && (
          <button type="button" className={styles.primary} onClick={() => onStartOffer(person)}>Issue a rehire offer (same ID)</button>
        )}
        {person.hasEmployeeAccount && (
          <>
            <Link className={styles.secondary} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={`/dashboard/admin/crm?employee=${encodeURIComponent(person.employeeProfileId ?? "")}#company-id-card`}>
              Company ID card
            </Link>
            <Link className={styles.secondary} style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }} href={`/dashboard/admin/crm?employee=${encodeURIComponent(person.employeeProfileId ?? "")}`}>
              CRM activity
            </Link>
          </>
        )}
      </div>

      {form?.kind === "joining" && (
        <JoiningForm api={api} offer={form.offer} rejoin={form.rejoin} onCancel={() => setForm(null)} onDone={(next) => applyPerson(next, form.rejoin ? "Rejoining recorded. The original login was re-enabled." : "Joining recorded.")} />
      )}
      {form?.kind === "notJoined" && (
        <NotJoinedForm api={api} offer={form.offer} onCancel={() => setForm(null)} onDone={(next) => applyPerson(next, "Recorded as did not join. The employee ID stays reserved for this person.")} />
      )}
      {form?.kind === "exit" && currentEpisode && (
        <ExitForm api={api} episode={currentEpisode} onCancel={() => setForm(null)} onDone={(next) => applyPerson(next, "Exit recorded. Access was suspended.")} />
      )}

      <h3 className={styles.sectionTitle}>Offer letters ({person.offers.length})</h3>
      <ul className={styles.list} aria-label="Offer versions">
        {offersNewestFirst.map((offer) => (
          <li key={offer.id} className={styles.card}>
            <div className={styles.cardTop}>
              <strong>Version {offer.version} · {offer.kind === "FIRST" ? "First offer" : offer.kind === "REOFFER" ? "Re-offer" : "Rehire offer"}</strong>
              <span>
                <OfferStatusBadge status={offer.status} />
                {offer.supersededByVersion !== null && <span className={styles.muted}> · replaced by v{offer.supersededByVersion}</span>}
              </span>
            </div>
            {offer.source === "HISTORICAL_IMPORT" ? (
              <p className={styles.muted} style={{ margin: 0 }}>Imported from a letter emailed before the register existed. The original PDF and exact terms are not stored here, so this version cannot be reprinted.</p>
            ) : (
              <p className={styles.muted} style={{ margin: 0 }}>{termsSummary(offer)}</p>
            )}
            <Facts
              items={[
                ["Issued", formatInstant(offer.issuedAt)],
                ...(offer.source === "REGISTER"
                  ? ([
                      ["Proposed joining", formatDay(offer.terms.proposedJoiningDate)],
                      ["Reporting manager", offer.terms.reportingManager ? offer.terms.reportingManager.fullName : "—"],
                    ] as Array<[string, ReactNode]>)
                  : []),
                ["Saved in register", offer.source === "REGISTER" ? "Yes" : "Record only (original PDF not stored)"],
                ["Emailed (recorded by HR)", offer.delivery.emailedRecordedAt ? formatInstant(offer.delivery.emailedRecordedAt) : "Not recorded"],
                ["Acceptance", offer.delivery.acceptanceProven ? `Recorded ${formatInstant(offer.acceptedAt)}` : "No acceptance on record"],
                ["Created by", offer.createdBy.displayName],
              ]}
            />
            {offer.statusReason && <p className={styles.muted} style={{ margin: 0 }}>Reason: {offer.statusReason}</p>}

            <div>
              <strong className={styles.muted}>PDF history ({offer.pdfHistory.length})</strong>
              {offer.pdfHistory.length === 0 && <p className={styles.muted} style={{ margin: "4px 0 0" }}>No PDF has been generated from this version yet.</p>}
              {offer.pdfHistory.map((entry) => (
                <div key={entry.id} className={styles.pdfRow}>
                  <span>{entry.event === "GENERATED" ? "Generated" : "Reprinted"} · {formatInstant(entry.at)} · {entry.actor.displayName}</span>
                  <span className={styles.hash} title={entry.sha256}>SHA-256 {entry.sha256.slice(0, 12)}…</span>
                </div>
              ))}
            </div>

            <div className={styles.actions}>
              {offer.source === "REGISTER" && (
                <button type="button" className={styles.secondary} disabled={pdfBusy !== null} onClick={() => void reprint(offer)}>
                  {pdfBusy === offer.id ? "Preparing PDF…" : `Download version ${offer.version} PDF`}
                </button>
              )}
              {allowedOfferTransitions(offer).map((to) => (
                <button key={to} type="button" className={styles.secondary} onClick={() => setForm({ kind: "transition", offer, to })}>
                  {TRANSITION_BUTTON[to]}
                </button>
              ))}
            </div>
            {form?.kind === "transition" && form.offer.id === offer.id && (
              <TransitionForm
                api={api}
                offer={offer}
                to={form.to}
                onCancel={() => setForm(null)}
                onDone={() => {
                  setNotice("Status recorded.");
                  setForm(null);
                  setAudit(null);
                  onChanged?.();
                  void load();
                }}
              />
            )}
          </li>
        ))}
      </ul>

      <h3 className={styles.sectionTitle}>Employment episodes</h3>
      <ol className={styles.timeline} aria-label="Employment episodes">
        {episodesNewestFirst.length === 0 && <li className={styles.muted}>No employment episode yet — only offers so far.</li>}
        {episodesNewestFirst.map((episode) => (
          <li key={episode.id}>
            <strong>Episode {episode.episodeNumber}</strong> <EpisodeStatusBadge status={episode.status} />
            <small>
              From offer v{episode.originatingOfferVersion}
              {episode.joinedOn ? ` · joined ${formatDay(episode.joinedOn)}` : ""}
              {episode.exitedOn ? ` · exited ${formatDay(episode.exitedOn)}` : ""}
              {episode.notJoinedOn ? ` · did not join (${formatDay(episode.notJoinedOn)})` : ""}
            </small>
            {episode.statusReason && <small>Reason: {episode.statusReason}</small>}
          </li>
        ))}
      </ol>
      {person.episodes.length > 1 && (
        <p className={styles.mutedBlock}>Each episode is separate: a rehire never extends the earlier period, so service is not shown as continuous.</p>
      )}

      <h3 className={styles.sectionTitle}>Salary history</h3>
      <ol className={styles.timeline} aria-label="Salary history">
        {person.salaryHistory.length === 0 && <li className={styles.muted}>No salary entries yet.</li>}
        {[...person.salaryHistory].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map((entry) => (
          <li key={entry.id}>
            <strong>INR {formatInr(entry.baseSalaryInr)} {entry.salaryBasis === "monthly" ? "per month" : "per annum"}</strong>
            <small>From {formatDay(entry.effectiveFrom)}{entry.offerVersion !== null ? ` · offer v${entry.offerVersion}` : ""} · recorded by {entry.recordedBy.displayName}</small>
          </li>
        ))}
      </ol>

      <h3 className={styles.sectionTitle}>Reporting manager history</h3>
      <ol className={styles.timeline} aria-label="Reporting manager history">
        {person.managerHistory.length === 0 && <li className={styles.muted}>No reporting manager recorded yet.</li>}
        {[...person.managerHistory].sort((a, b) => b.from.localeCompare(a.from)).map((entry) => (
          <li key={entry.id}>
            <strong>{entry.manager.fullName}</strong> <span className={styles.muted}>({entry.manager.employeeCode})</span>
            <small>{formatDay(entry.from)} → {entry.to ? formatDay(entry.to) : "present"}{entry.offerVersion !== null ? ` · offer v${entry.offerVersion}` : ""}</small>
          </li>
        ))}
      </ol>

      <h3 className={styles.sectionTitle}>Audit trail</h3>
      {audit === null ? (
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={auditBusy} onClick={() => void loadAudit(false)}>
            {auditBusy ? "Loading…" : "Show audit trail"}
          </button>
          <span className={styles.muted}>Every status change, PDF event and identity decision, with who and when.</span>
        </div>
      ) : (
        <>
          <ol className={styles.timeline} aria-label="Audit trail">
            {audit.length === 0 && <li className={styles.muted}>No audit entries.</li>}
            {audit.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.action}</strong> <span className={styles.muted}>· {entry.subject.label}</span>
                <small>
                  {formatInstant(entry.at)} · {entry.actor.displayName}
                  {entry.fromStatus || entry.toStatus ? ` · ${entry.fromStatus ?? "—"} → ${entry.toStatus ?? "—"}` : ""}
                </small>
                {entry.reason && <small>Reason: {entry.reason}</small>}
              </li>
            ))}
          </ol>
          {auditCursor && (
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={auditBusy} onClick={() => void loadAudit(true)}>
                {auditBusy ? "Loading…" : "Load older entries"}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
