"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { extractResumeHints, DEFAULT_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR, formatInr } from "../../app/(dashboard)/dashboard/admin/crm/offer-letter";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure } from "../../lib/hr-register/errors";
import { parseRupees } from "../../lib/hr-register/format";
import { generateOfferPdf, type PdfOutcome } from "../../lib/hr-register/pdf";
import { useIdempotencyKeys } from "../../lib/hr-register/use-idempotency";
import { newIdempotencyKey } from "../../lib/idempotency";
import type {
  HrCreateOfferInput,
  HrCreateOfferResult,
  HrEmployeeOption,
  HrMatchResult,
  HrOfferTermsInput,
  HrPersonSummary,
} from "../../lib/hr-register/types";
import { MatchReview, type MatchDecision } from "./MatchReview";
import { Banner, CodeChip, LifecycleBadge, OfferStatusBadge } from "./parts";
import styles from "./hr-register.module.css";

const DEFAULT_ROLE = "Field Sales Executive";

export type OfferComposerProps = {
  api?: HrRegisterApi;
  /** A verified existing person chosen in the register (re-offer / rehire). Identity is then fixed. */
  presetPerson?: HrPersonSummary | null;
  onSaved?: (result: HrCreateOfferResult) => void;
  onOpenPerson?: (personId: string) => void;
  onClearPreset?: () => void;
  /** Hands the PDF bytes to the browser; replaced in tests. */
  deliverPdf?: (bytes: Uint8Array, filename: string) => void;
};

type Terms =
  | { ok: true; value: HrOfferTermsInput }
  | { ok: false; message: string };

function readTerms(form: {
  role: string;
  salary: string;
  basis: "monthly" | "annual";
  target: string;
  incentive: string;
  joining: string;
  managerId: string;
  city: string;
}): Terms {
  const baseSalaryInr = parseRupees(form.salary);
  if (baseSalaryInr === null) return { ok: false, message: "Enter a valid base salary greater than zero." };

  const targetRaw = form.target.trim();
  const incentiveRaw = form.incentive.trim();
  if (Boolean(targetRaw) !== Boolean(incentiveRaw)) {
    return { ok: false, message: "Enter both Sales Target and Incentives Beyond Target, or leave both blank to use the standard policy." };
  }
  let salesTarget: number | null = null;
  let incentiveBeyondTargetInr: number | null = null;
  if (targetRaw) {
    salesTarget = Number(targetRaw.replace(/,/g, ""));
    incentiveBeyondTargetInr = Number(incentiveRaw.replace(/,/g, ""));
    if (!Number.isSafeInteger(salesTarget) || salesTarget < 1) {
      return { ok: false, message: "Sales Target must be a positive whole number of shops." };
    }
    if (!Number.isSafeInteger(incentiveBeyondTargetInr) || incentiveBeyondTargetInr < 1 || incentiveBeyondTargetInr > 1_000_000) {
      return { ok: false, message: "Incentives Beyond Target must be a positive whole rupee amount per additional shop." };
    }
  }
  return {
    ok: true,
    value: {
      role: form.role.trim() || DEFAULT_ROLE,
      baseSalaryInr,
      salaryBasis: form.basis,
      salesTarget,
      incentiveBeyondTargetInr,
      proposedJoiningDate: form.joining || null,
      reportingManagerId: form.managerId || null,
      city: form.city.trim() || null,
    },
  };
}

export default function OfferComposer({ api = httpHrRegisterApi, presetPerson = null, onSaved, onOpenPerson, onClearPreset, deliverPdf }: OfferComposerProps) {
  const { keyFor, release } = useIdempotencyKeys();
  const inFlight = useRef(false);

  const [resume, setResume] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");

  const [manualBusy, setManualBusy] = useState(false);
  const [manualMatch, setManualMatch] = useState<HrMatchResult | null>(null);
  const [manualDecision, setManualDecision] = useState<MatchDecision | null>(null);
  const [presetState, setPresetState] = useState<{ personId: string; result: HrMatchResult | null; person: HrPersonSummary | null; error: string | null } | null>(null);

  const [role, setRole] = useState(DEFAULT_ROLE);
  const [salary, setSalary] = useState("");
  const [basis, setBasis] = useState<"monthly" | "annual">("monthly");
  const [target, setTarget] = useState("");
  const [incentive, setIncentive] = useState("");
  const [joining, setJoining] = useState("");
  const [managerId, setManagerId] = useState("");
  const [city, setCity] = useState("");
  const [managers, setManagers] = useState<HrEmployeeOption[]>([]);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<HrCreateOfferResult | null>(null);
  const [pdf, setPdf] = useState<PdfOutcome | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [emailRecorded, setEmailRecorded] = useState(false);

  useEffect(() => {
    let live = true;
    api.listManagers().then((rows) => live && setManagers(rows)).catch(() => live && setManagers([]));
    return () => {
      live = false;
    };
  }, [api]);

  // A preset person fixes the identity: ask the register for a match token bound to that exact code.
  useEffect(() => {
    if (!presetPerson) return;
    let live = true;
    api
      .matchIdentity({ employeeCode: presetPerson.employeeCode })
      .then((result) => {
        if (!live) return;
        const exact = result.matches.find((candidate) => candidate.person.id === presetPerson.id)?.person ?? null;
        setPresetState({
          personId: presetPerson.id,
          result: exact ? result : null,
          person: exact,
          error: exact ? null : "The register no longer returns this person. Search again.",
        });
        if (exact) setCity((current) => current || exact.city || "");
      })
      .catch((failure: unknown) => live && setPresetState({ personId: presetPerson.id, result: null, person: null, error: describeHrFailure(failure) }));
    return () => {
      live = false;
    };
  }, [api, presetPerson]);

  const presetReady = presetPerson && presetState?.personId === presetPerson.id ? presetState : null;
  const match = presetPerson ? presetReady?.result ?? null : manualMatch;
  const decision: MatchDecision | null = presetPerson
    ? presetReady?.person
      ? { mode: "EXISTING", person: presetReady.person }
      : null
    : manualDecision;
  const matchBusy = presetPerson ? presetReady === null : manualBusy;
  const shownError = error ?? presetReady?.error ?? null;

  const identityLocked = Boolean(presetPerson) || saved !== null;
  const resolvedPerson = decision?.mode === "EXISTING" ? decision.person : null;
  const termsForm = useMemo(
    () => ({ role, salary, basis, target, incentive, joining, managerId, city }),
    [role, salary, basis, target, incentive, joining, managerId, city],
  );

  function resetIdentityCheck() {
    setManualMatch(null);
    setManualDecision(null);
  }

  async function onResumeChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setResume(file);
    if (!file || presetPerson) return;
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "txt"].includes(extension) || file.size > 8 * 1024 * 1024) {
      setResume(null);
      event.target.value = "";
      setNotice("Use a PDF, DOCX or TXT resume up to 8 MB.");
      return;
    }
    try {
      const hints = await extractResumeHints(file);
      if (hints.candidateName) setName(hints.candidateName);
      if (hints.email) setEmail(hints.email);
      if (hints.phone) setPhone(hints.phone);
      if (hints.address) setAddress(hints.address);
      resetIdentityCheck();
      setNotice("Resume read in this browser only. Verify the details, then check existing records.");
    } catch {
      setNotice("Resume selected. Enter the candidate details, then check existing records.");
    }
  }

  async function checkRecords() {
    setError(null);
    setNotice(null);
    if (name.trim().length < 2) {
      setError("Enter the candidate name first.");
      return;
    }
    setManualBusy(true);
    try {
      const result = await api.matchIdentity({
        fullName: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setManualMatch(result);
      setManualDecision(null);
    } catch (failure) {
      setError(describeHrFailure(failure));
    } finally {
      setManualBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || saved) return;
    setError(null);
    setNotice(null);
    setPdfError(null);

    if (!match || !decision) {
      setError("Check existing records and confirm who this candidate is before saving an offer.");
      return;
    }
    const terms = readTerms(termsForm);
    if (!terms.ok) {
      setError(terms.message);
      return;
    }

    const input: HrCreateOfferInput =
      decision.mode === "EXISTING"
        ? { identity: { mode: "EXISTING", personId: decision.person.id, decisionToken: match.decisionToken }, terms: terms.value }
        : {
            identity: {
              mode: "NEW",
              person: { fullName: name.trim(), email: email.trim() || undefined, phone: phone.trim() || undefined, address: address.trim() || undefined },
              decisionToken: match.decisionToken,
              overrideReason: decision.overrideReason,
            },
            terms: terms.value,
          };

    inFlight.current = true;
    setSaving(true);
    let result: HrCreateOfferResult;
    try {
      result = await api.createOffer(input, keyFor(input));
      release(input);
    } catch (failure) {
      // Keep the key: a retry of the very same form must resolve to the same single record.
      setError(describeHrFailure(failure, "Could not save the offer. Nothing was issued."));
      inFlight.current = false;
      setSaving(false);
      return;
    }

    setSaved(result);
    onSaved?.(result);
    try {
      const outcome = await generateOfferPdf({
        api,
        employeeCode: result.person.employeeCode,
        candidateName: result.letter.candidateName,
        offer: result.offer,
        contacts: result.letter,
        event: "GENERATED",
        deliver: deliverPdf,
      });
      setPdf(outcome);
    } catch {
      setPdfError("The offer is saved, but the PDF could not be generated. Use “Generate PDF” below.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function regeneratePdf() {
    if (!saved || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setPdfError(null);
    try {
      const outcome = await generateOfferPdf({
        api,
        employeeCode: saved.person.employeeCode,
        candidateName: saved.letter.candidateName,
        offer: saved.offer,
        contacts: saved.letter,
        event: pdf ? "REPRINTED" : "GENERATED",
        deliver: deliverPdf,
      });
      setPdf(outcome);
    } catch {
      setPdfError("Could not generate the PDF. Your saved offer is unchanged.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function recordEmailed() {
    if (!saved || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      const updated = await api.transitionOffer(saved.offer.id, "SENT", null, newIdempotencyKey());
      setSaved({ ...saved, offer: updated });
      setEmailRecorded(true);
    } catch (failure) {
      setError(describeHrFailure(failure));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  function startAnother() {
    setSaved(null);
    setPdf(null);
    setPdfError(null);
    setEmailRecorded(false);
    setResume(null);
    setName("");
    setEmail("");
    setPhone("");
    setAddress("");
    setSalary("");
    setTarget("");
    setIncentive("");
    setJoining("");
    setNotice(null);
    setError(null);
    resetIdentityCheck();
    onClearPreset?.();
  }

  const identityLabel = resolvedPerson
    ? `${resolvedPerson.employeeCode} — existing ID will be reused`
    : decision?.mode === "NEW"
      ? "A new permanent ID will be assigned when you save"
      : "Assigned by the register when you save";

  return (
    <section id="offer-letter" className={styles.panel} aria-labelledby="hr-offer-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>HR automation</p>
          <h2 id="hr-offer-title">Offer letter generator</h2>
        </div>
        <span className={styles.muted}>Check records → save offer → PDF</span>
      </div>

      {shownError && <Banner kind="error">{shownError}</Banner>}
      {notice && <Banner kind="info">{notice}</Banner>}

      {saved ? (
        <div className={styles.stack} data-testid="offer-saved">
          <Banner kind="ok">
            Offer saved as version {saved.offer.version} for <CodeChip code={saved.person.employeeCode} />. This employee ID is permanent and will be reused for any later offer.
          </Banner>
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <strong>{saved.letter.candidateName}</strong>
              <span>
                <CodeChip code={saved.person.employeeCode} /> <OfferStatusBadge status={saved.offer.status} />
              </span>
            </div>
            {pdf ? (
              <p className={styles.muted}>
                {pdf.filename} downloaded.{" "}
                {pdf.recorded ? "PDF recorded in this offer’s history." : "The PDF history entry could not be recorded — it will not appear in the history until you generate it again."}
              </p>
            ) : (
              !pdfError && <p className={styles.muted}>Generating the PDF…</p>
            )}
            {pdfError && <Banner kind="warn">{pdfError}</Banner>}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={saving} onClick={() => void regeneratePdf()}>
              {pdf ? "Download PDF again" : "Generate PDF"}
            </button>
            <button type="button" className={styles.secondary} disabled={saving || emailRecorded || saved.offer.status !== "ISSUED"} onClick={() => void recordEmailed()}>
              {emailRecorded || saved.offer.status === "SENT" ? "Recorded as emailed" : "Record as emailed"}
            </button>
            {onOpenPerson && (
              <button type="button" className={styles.secondary} onClick={() => onOpenPerson(saved.person.id)}>
                Open employee record
              </button>
            )}
            <button type="button" className={styles.secondary} disabled={saving} onClick={startAnother}>
              Start another offer
            </button>
          </div>
          <p className={styles.muted}>“Record as emailed” only notes in the register that you sent the letter. FastQue does not send email from this screen.</p>
        </div>
      ) : (
        <form className={styles.stack} onSubmit={(event) => void save(event)} noValidate>
          <label>
            <span>Candidate resume <small>(optional — read only in this browser, never uploaded or stored)</small></span>
            <input type="file" accept=".pdf,.docx,.txt" onChange={(event) => void onResumeChange(event)} disabled={identityLocked} />
            {resume && <small>{resume.name}</small>}
          </label>

          <fieldset className={styles.stack} style={{ border: 0, margin: 0, padding: 0 }}>
            <legend className={styles.sectionTitle}>1. Who is the candidate?</legend>
            {presetPerson ? (
              <Banner kind="info">
                Re-offering <strong>{presetPerson.fullName}</strong> (<CodeChip code={presetPerson.employeeCode} /> <LifecycleBadge person={presetPerson} />). The existing ID is reused; contact details stay as saved in the register.{" "}
                {onClearPreset && (
                  <button type="button" className={styles.secondary} onClick={onClearPreset} style={{ minHeight: 36, marginLeft: 6 }}>
                    Choose someone else
                  </button>
                )}
              </Banner>
            ) : (
              <div className={styles.grid}>
                <label>
                  <span>Candidate name</span>
                  <input value={name} onChange={(event) => { setName(event.target.value); resetIdentityCheck(); }} placeholder="Full name" autoComplete="off" />
                </label>
                <label>
                  <span>Email <small>(helps catch duplicates)</small></span>
                  <input type="email" value={email} onChange={(event) => { setEmail(event.target.value); resetIdentityCheck(); }} autoComplete="off" />
                </label>
                <label>
                  <span>Phone <small>(helps catch duplicates)</small></span>
                  <input value={phone} onChange={(event) => { setPhone(event.target.value); resetIdentityCheck(); }} inputMode="tel" autoComplete="off" />
                </label>
                <label>
                  <span>Address <small>(optional)</small></span>
                  <input value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="off" />
                </label>
              </div>
            )}
            {!presetPerson && (
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} disabled={matchBusy} onClick={() => void checkRecords()}>
                  {matchBusy ? "Checking records…" : "Check existing records"}
                </button>
              </div>
            )}
            {matchBusy && presetPerson && <p className={styles.muted}>Confirming this person in the register…</p>}
            {match && !presetPerson && (
              <MatchReview
                result={match}
                disabled={saving}
                onDecide={(next) => setManualDecision(next)}
              />
            )}
            {decision && !presetPerson && (
              <Banner kind="ok">
                {decision.mode === "EXISTING"
                  ? `Using existing identity ${decision.person.employeeCode} (${decision.person.fullName}).`
                  : decision.overrideReason
                    ? "New identity confirmed with a recorded reason."
                    : "New candidate confirmed."}
              </Banner>
            )}
          </fieldset>

          <fieldset className={styles.stack} style={{ border: 0, margin: 0, padding: 0 }} disabled={!decision}>
            <legend className={styles.sectionTitle}>2. Offer terms</legend>
            <div className={styles.grid}>
              <label>
                <span>Employee ID</span>
                <input readOnly value={identityLabel} aria-readonly="true" />
              </label>
              <label>
                <span>Offered role</span>
                <input value={role} onChange={(event) => setRole(event.target.value)} placeholder={DEFAULT_ROLE} maxLength={120} />
              </label>
              <label>
                <span>Base salary (INR)</span>
                <input value={salary} onChange={(event) => setSalary(event.target.value)} inputMode="decimal" placeholder="50000" />
              </label>
              <label>
                <span>Salary basis</span>
                <select value={basis} onChange={(event) => setBasis(event.target.value as "monthly" | "annual")}>
                  <option value="monthly">Per month</option>
                  <option value="annual">Per annum</option>
                </select>
              </label>
              <label>
                <span>Sales Target <small>(shops per performance period)</small></span>
                <input type="number" min="1" step="1" inputMode="numeric" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="e.g. 85" />
              </label>
              <label>
                <span>Incentives Beyond Target <small>(INR per additional shop)</small></span>
                <input type="number" min="1" max="1000000" step="1" inputMode="numeric" value={incentive} onChange={(event) => setIncentive(event.target.value)} placeholder="e.g. 100" />
              </label>
              <label>
                <span>Proposed joining date <small>(optional)</small></span>
                <input type="date" value={joining} onChange={(event) => setJoining(event.target.value)} />
              </label>
              <label>
                <span>Reporting manager <small>(optional)</small></span>
                <select value={managerId} onChange={(event) => setManagerId(event.target.value)}>
                  <option value="">Not assigned</option>
                  {managers.map((manager) => (
                    <option key={manager.id} value={manager.id}>{`${manager.fullName} (${manager.employeeCode})`}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>City <small>(optional)</small></span>
                <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} />
              </label>
              <label>
                <span>Expected Performance Incentive</span>
                <input readOnly value={`INR ${formatInr(DEFAULT_EXPECTED_PERFORMANCE_INCENTIVE_MONTHLY_INR)} per month (standard)`} aria-readonly="true" />
              </label>
            </div>
            <p className={styles.mutedBlock}>
              Enter both Sales Target and Incentives Beyond Target to set offer-specific terms; leave both blank to keep the standard 85-shop target and 86–100 / 101+ slabs.
              The beyond-target incentive is variable, not guaranteed salary. The standard Expected Performance Incentive is fixed by policy and cannot be edited here.
            </p>
          </fieldset>

          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={saving || !decision}>
              {saving ? "Saving offer…" : "Save offer & generate PDF"}
            </button>
            <p className={styles.mutedBlock} style={{ margin: 0 }}>
              The offer is saved to the register first and receives its permanent employee ID; the PDF is then generated from that saved version. No email is sent.
            </p>
          </div>
        </form>
      )}
    </section>
  );
}
