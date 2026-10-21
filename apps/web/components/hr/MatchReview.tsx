"use client";

import { useState } from "react";
import { REASON_MIN, validateReason } from "../../lib/hr-register/format";
import { OFFER_STATUS_LABEL } from "../../lib/hr-register/lifecycle";
import type { HrMatchReason, HrMatchResult, HrPersonSummary } from "../../lib/hr-register/types";
import { Badge, CodeChip, Facts, LifecycleBadge } from "./parts";
import styles from "./hr-register.module.css";

const REASON_LABEL: Record<HrMatchReason, string> = {
  EXACT_CODE: "Same employee ID",
  EMAIL: "Same email",
  PHONE: "Same phone",
  NAME_EXACT: "Same name",
  NAME_SIMILAR: "Similar name",
  PRIOR_OFFER: "Has a prior offer",
};

export type MatchDecision =
  | { mode: "EXISTING"; person: HrPersonSummary }
  | { mode: "NEW"; overrideReason?: string };

/**
 * Identity confirmation step. A name, email or phone match is a prompt to LOOK, never an authority:
 * HR must pick an existing person or explicitly declare a new one. When the server says new
 * identities are blocked (ambiguous matches), a reasoned override is mandatory and is audited.
 */
export function MatchReview({
  result,
  disabled,
  onDecide,
}: {
  result: HrMatchResult;
  disabled?: boolean;
  onDecide: (decision: MatchDecision) => void;
}) {
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const hasMatches = result.matches.length > 0;
  const blocked = result.blocksNewIdentity;
  const reasonCheck = validateReason(reason);
  const newIdentityReady = !hasMatches || (acknowledged && (!blocked || reasonCheck.ok));

  return (
    <section aria-label="Possible existing records" className={styles.stack}>
      {hasMatches ? (
        <>
          <p className={styles.mutedBlock}>
            {result.matches.length === 1 ? "1 existing record looks related." : `${result.matches.length} existing records look related.`}{" "}
            A shared name, email or phone is only a warning — check the details, then choose who this is. Nothing is merged automatically.
          </p>
          <ul className={styles.list}>
            {result.matches.map(({ person, reasons, strength }) => (
              <li key={person.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <strong>{person.fullName}</strong>
                  <span>
                    <CodeChip code={person.employeeCode} /> <LifecycleBadge person={person} />
                  </span>
                </div>
                <div className={styles.reasons}>
                  <Badge tone={strength === "STRONG" ? "warn" : "neutral"}>{strength === "STRONG" ? "Strong match" : "Possible match"}</Badge>
                  {reasons.map((reasonKey) => (
                    <Badge key={reasonKey}>{REASON_LABEL[reasonKey]}</Badge>
                  ))}
                </div>
                <Facts
                  items={[
                    ["Email", person.maskedEmail ?? "—"],
                    ["Phone", person.maskedPhone ?? "—"],
                    ["Offers", person.latestOfferStatus ? `${person.offerCount} (latest: ${OFFER_STATUS_LABEL[person.latestOfferStatus]})` : "None recorded (hired before the register)"],
                    ["City", person.city ?? "—"],
                  ]}
                />
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={disabled} onClick={() => onDecide({ mode: "EXISTING", person })}>
                    Same person — reuse {person.employeeCode}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className={styles.subform}>
            <p className={styles.mutedBlock}>
              <strong>None of these is the same person?</strong>{" "}
              {blocked
                ? "These matches are too close to create a new identity without a recorded reason."
                : "Confirm you checked the records above."}
              {result.overrideRequiresSenior &&
                " The contact and name match an existing person exactly, so only a Co-Founder or Platform Admin can create a separate identity."}
            </p>
            <div className={styles.stack}>
              {blocked && (
                <label>
                  <span>Why is this a different person? (kept in the audit trail)</span>
                  <textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={`At least ${REASON_MIN} characters`} />
                </label>
              )}
              <label className={styles.checkRow}>
                <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
                <span>I compared these records and this candidate is a different person.</span>
              </label>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={disabled || !newIdentityReady}
                  onClick={() => onDecide({ mode: "NEW", overrideReason: blocked && reasonCheck.ok ? reasonCheck.value : undefined })}
                >
                  Create a new identity
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className={styles.mutedBlock}>No existing candidate, offer or employee matched these details.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={disabled} onClick={() => onDecide({ mode: "NEW" })}>
              Continue as a new candidate
            </button>
          </div>
        </>
      )}
    </section>
  );
}
