"use client";

import { useRef, useState, type FormEvent } from "react";
import type { HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure } from "../../lib/hr-register/errors";
import { formatDay, todayInIndia, validateReason } from "../../lib/hr-register/format";
import { useIdempotencyKeys } from "../../lib/hr-register/use-idempotency";
import type { HrEmploymentEpisode, HrOfferTransition, HrOfferVersion, HrPersonDetail } from "../../lib/hr-register/types";
import { Banner } from "./parts";
import styles from "./hr-register.module.css";

type CommonProps = {
  api: HrRegisterApi;
  onCancel: () => void;
};

/** Shared submit plumbing: one in-flight request, one idempotency key per distinct body. */
function useSubmit() {
  const { keyFor, release } = useIdempotencyKeys();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(body: unknown, call: (key: string) => Promise<T>, done: (value: T) => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const value = await call(keyFor(body));
      release(body);
      done(value);
    } catch (failure) {
      setError(describeHrFailure(failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

const TRANSITION_COPY: Record<HrOfferTransition, { title: string; help: string; reasonRequired: boolean; confirm: string }> = {
  SENT: {
    title: "Record as emailed",
    help: "Notes that you emailed this letter. FastQue does not send the email, and a sent letter does not mean the candidate joined.",
    reasonRequired: false,
    confirm: "Record as emailed",
  },
  ACCEPTED: {
    title: "Record acceptance",
    help: "Use only when the candidate has actually accepted. Add where the acceptance came from.",
    reasonRequired: false,
    confirm: "Record acceptance",
  },
  DECLINED: {
    title: "Record decline",
    help: "The employee ID stays reserved to this person for any future offer.",
    reasonRequired: true,
    confirm: "Record decline",
  },
  EXPIRED: {
    title: "Record expiry",
    help: "The employee ID stays reserved to this person for any future offer.",
    reasonRequired: true,
    confirm: "Record expiry",
  },
};

export function TransitionForm({ api, offer, to, onCancel, onDone }: CommonProps & { offer: HrOfferVersion; to: HrOfferTransition; onDone: (offer: HrOfferVersion) => void }) {
  const copy = TRANSITION_COPY[to];
  const [reason, setReason] = useState("");
  const { busy, error, setError, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    let text: string | null = reason.trim() || null;
    if (copy.reasonRequired || text) {
      const check = validateReason(reason);
      if (!check.ok) {
        setError(check.message);
        return;
      }
      text = check.value;
    }
    const body = { offerId: offer.id, to, reason: text };
    void run(body, (key) => api.transitionOffer(offer.id, to, text, key), onDone);
  }

  return (
    <form className={`${styles.subform} ${styles.stack}`} onSubmit={submit} aria-label={copy.title}>
      <strong>{copy.title} — version {offer.version}</strong>
      <p className={styles.mutedBlock}>{copy.help}</p>
      {error && <Banner kind="error">{error}</Banner>}
      <label>
        <span>{copy.reasonRequired ? "Reason" : "Note (optional)"}</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : copy.confirm}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function JoiningForm({ api, offer, rejoin, onCancel, onDone }: CommonProps & { offer: HrOfferVersion; rejoin: boolean; onDone: (person: HrPersonDetail) => void }) {
  const today = todayInIndia();
  // A proposed joining date in the future is not a joining: default to today unless it has already passed.
  const proposed = offer.terms.proposedJoiningDate;
  const [joinedOn, setJoinedOn] = useState(proposed && proposed <= today ? proposed : today);
  const [territory, setTerritory] = useState(offer.terms.city ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [approved, setApproved] = useState(false);
  const { busy, error, setError, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!joinedOn) return setError("Choose the actual joining date.");
    if (password.length < 8 || password.length > 72) return setError("The temporary password must be 8 to 72 characters.");
    if (password !== confirm) return setError("The passwords do not match.");
    if (!approved) return setError("Confirm the joining approval to continue.");
    const input = { joinedOn, territory: territory.trim() || undefined, temporaryPassword: password };
    void run({ offerId: offer.id, joinedOn, territory: input.territory }, (key) => api.recordJoining(offer.id, input, key), (person) => {
      setPassword("");
      setConfirm("");
      onDone(person);
    });
  }

  return (
    <form className={`${styles.subform} ${styles.stack}`} onSubmit={submit} aria-label="Record joining">
      <strong>{rejoin ? "Record rejoining" : "Record joining"} — version {offer.version}</strong>
      <p className={styles.mutedBlock}>
        {rejoin
          ? "The original login is re-enabled with the new temporary password and every old session is signed out. No second profile or employee ID is created."
          : "This is the only step that creates the employee login. The permanent employee ID issued with the offer is used."}
      </p>
      {error && <Banner kind="error">{error}</Banner>}
      <div className={styles.grid}>
        <label>
          <span>Actual joining date</span>
          <input type="date" value={joinedOn} max={todayInIndia()} onChange={(event) => setJoinedOn(event.target.value)} />
        </label>
        <label>
          <span>Territory / area</span>
          <input value={territory} onChange={(event) => setTerritory(event.target.value)} maxLength={160} />
        </label>
        <label>
          <span>Temporary password</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
        <label>
          <span>Confirm password</span>
          <input type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" />
        </label>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
        <span>I approve joining on {formatDay(joinedOn)} and the login being enabled.</span>
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : rejoin ? "Approve rejoining" : "Approve joining"}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function NotJoinedForm({ api, offer, onCancel, onDone }: CommonProps & { offer: HrOfferVersion; onDone: (person: HrPersonDetail) => void }) {
  const [decidedOn, setDecidedOn] = useState(todayInIndia());
  const [reason, setReason] = useState("");
  const { busy, error, setError, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    const check = validateReason(reason);
    if (!check.ok) return setError(check.message);
    if (!decidedOn) return setError("Choose the date.");
    const input = { decidedOn, reason: check.value };
    void run({ offerId: offer.id, ...input }, (key) => api.recordNotJoined(offer.id, input, key), onDone);
  }

  return (
    <form className={`${styles.subform} ${styles.stack}`} onSubmit={submit} aria-label="Record not joined">
      <strong>Record “did not join” — version {offer.version}</strong>
      <p className={styles.mutedBlock}>The employee ID stays with this person. A later offer, even months later, reuses it. No login is ever created from an offer alone.</p>
      {error && <Banner kind="error">{error}</Banner>}
      <div className={styles.grid}>
        <label>
          <span>Date</span>
          <input type="date" value={decidedOn} max={todayInIndia()} onChange={(event) => setDecidedOn(event.target.value)} />
        </label>
        <label className={styles.wide}>
          <span>Reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </label>
      </div>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Saving…" : "Record not joined"}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function ExitForm({ api, episode, onCancel, onDone }: CommonProps & { episode: HrEmploymentEpisode; onDone: (person: HrPersonDetail) => void }) {
  const [exitedOn, setExitedOn] = useState(todayInIndia());
  const [reason, setReason] = useState("");
  const [approved, setApproved] = useState(false);
  const { busy, error, setError, run } = useSubmit();

  function submit(event: FormEvent) {
    event.preventDefault();
    const check = validateReason(reason);
    if (!check.ok) return setError(check.message);
    if (!exitedOn) return setError("Choose the last working day.");
    if (!approved) return setError("Confirm the exit to continue.");
    const input = { exitedOn, reason: check.value };
    void run({ episodeId: episode.id, ...input }, (key) => api.recordExit(episode.id, input, key), onDone);
  }

  return (
    <form className={`${styles.subform} ${styles.stack}`} onSubmit={submit} aria-label="Record exit">
      <strong>Record exit — employment episode {episode.episodeNumber}</strong>
      <p className={styles.mutedBlock}>Access is suspended and all sessions are signed out. Service dates, CRM history and the employee ID are kept for any future rehire.</p>
      {error && <Banner kind="error">{error}</Banner>}
      <div className={styles.grid}>
        <label>
          <span>Last working day</span>
          <input type="date" value={exitedOn} max={todayInIndia()} onChange={(event) => setExitedOn(event.target.value)} />
        </label>
        <label className={styles.wide}>
          <span>Reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
        </label>
      </div>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />
        <span>I confirm this employee has left and access should be suspended.</span>
      </label>
      <div className={styles.actions}>
        <button type="submit" className={styles.danger} disabled={busy}>{busy ? "Saving…" : "Record exit"}</button>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
