"use client";

import { useEffect, useRef, useState } from "react";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import { describeHrFailure } from "../../lib/hr-register/errors";
import { formatDay, normalizeEmployeeCodeInput } from "../../lib/hr-register/format";
import { useIdempotencyKeys } from "../../lib/hr-register/use-idempotency";
import type { HrReconciliationItem, HrReconciliationStatus } from "../../lib/hr-register/types";
import { Badge, Banner, CodeChip, Facts } from "./parts";
import styles from "./hr-register.module.css";

const STATUS_LABEL: Record<HrReconciliationStatus, string> = {
  UNVERIFIED: "Needs verification",
  LINKED: "Linked to an existing ID",
  IDENTITY_CREATED: "New identity created",
  DUPLICATE: "Duplicate / forward",
};

const SOURCE_LABEL: Record<HrReconciliationItem["source"], string> = {
  SENT_MAIL_AUDIT: "Sent-mail audit",
  PDF_REVIEW: "PDF review",
  MANUAL: "Manual entry",
};

type Mode = { itemId: string; kind: "link" | "duplicate" | "create" } | null;

/**
 * Previously emailed offers that were never saved. Each row is a worklist item, NOT a person:
 * its employee ID stays UNVERIFIED until HR links the original ID that was printed on the letter
 * or found in the register. Nothing here derives or invents an ID number.
 */
export default function ReconciliationWorklist({ api = httpHrRegisterApi, onChanged }: { api?: HrRegisterApi; onChanged?: () => void }) {
  const [items, setItems] = useState<HrReconciliationItem[]>([]);
  const [filter, setFilter] = useState<HrReconciliationStatus | "ALL">("UNVERIFIED");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [personRef, setPersonRef] = useState("");
  const [historyChecked, setHistoryChecked] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState("");
  const inFlight = useRef(false);
  const { keyFor, release } = useIdempotencyKeys();

  async function loadMore(from: string) {
    try {
      const page = await api.listReconciliation(filter, from);
      setItems((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (failure) {
      setError(describeHrFailure(failure, "Could not load the reconciliation worklist."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let live = true;
    api
      .listReconciliation(filter, null)
      .then((page) => {
        if (!live) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((failure: unknown) => live && setError(describeHrFailure(failure, "Could not load the reconciliation worklist.")))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [api, filter]);

  function openMode(next: Mode) {
    setMode(next);
    setPersonRef("");
    setHistoryChecked(false);
    setDuplicateOf("");
    setError(null);
  }

  async function act(body: unknown, call: (key: string) => Promise<HrReconciliationItem>, message: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    try {
      const updated = await call(keyFor(body));
      release(body);
      setItems((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setMode(null);
      setNotice(message);
      onChanged?.();
    } catch (failure) {
      setError(describeHrFailure(failure));
    } finally {
      inFlight.current = false;
    }
  }

  async function link(item: HrReconciliationItem) {
    const code = normalizeEmployeeCodeInput(personRef);
    if (!code) {
      setError("Enter the employee ID printed on the original letter, like FQ-FE-00123.");
      return;
    }
    // Resolve the code in the register first: the server, not the typed text, decides who it belongs to.
    try {
      const page = await api.search({ q: "", employeeCode: code, lifecycle: "ALL", offerStatus: "ALL", city: "", managerId: "", issuedFrom: "", issuedTo: "" }, null);
      const person = page.items.find((candidate) => candidate.employeeCode === code);
      if (!person) {
        setError(`No one in the register has ${code}. Do not create an ID from this row; check the original letter or the employee list.`);
        return;
      }
      await act({ itemId: item.id, personId: person.id }, (key) => api.linkReconciliation(item.id, person.id, key), `Linked to ${person.employeeCode} (${person.fullName}).`);
    } catch (failure) {
      setError(describeHrFailure(failure));
    }
  }

  return (
    <section id="reconciliation" className={styles.panel} aria-labelledby="hr-recon-title">
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.eyebrow}>Historical letters</p>
          <h2 id="hr-recon-title">Reconciliation worklist</h2>
          <p className={styles.mutedBlock}>
            Letters that were emailed before the register existed. Their employee IDs are <strong>unverified</strong> until you link the original ID.
            Nothing is guessed from names or e-mail addresses, and a forward of the same letter is not a second person.
          </p>
        </div>
        <label style={{ display: "grid", gap: 4, fontSize: "var(--bc-text-xs)", fontWeight: 700 }}>
          <span>Show</span>
          <select value={filter} onChange={(event) => { setLoading(true); setFilter(event.target.value as HrReconciliationStatus | "ALL"); }} style={{ minHeight: 44, borderRadius: 8, padding: "0 10px", background: "#0d0d12", color: "#f7f7fb", border: "1px solid #3a3a48" }}>
            <option value="ALL">All items</option>
            {(Object.keys(STATUS_LABEL) as HrReconciliationStatus[]).map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
          </select>
        </label>
      </div>

      {error && <Banner kind="error">{error}</Banner>}
      {notice && <Banner kind="ok">{notice}</Banner>}

      <ul className={styles.list} aria-label="Reconciliation items">
        {items.map((item) => (
          <li key={item.id} className={styles.card}>
            <div className={styles.cardTop}>
              <strong>{item.candidateLabel ?? "Candidate not read from letter"}</strong>
              <span>
                {item.status === "LINKED" && item.linkedPerson ? (
                  <CodeChip code={item.linkedPerson.employeeCode} />
                ) : (
                  <span className={`${styles.badge} ${styles.unverified}`}>ID UNVERIFIED</span>
                )}{" "}
                <Badge tone={item.status === "UNVERIFIED" ? "warn" : "good"}>{STATUS_LABEL[item.status]}</Badge>
              </span>
            </div>
            <Facts
              items={[
                ["Letter sent", formatDay(item.sentOn)],
                ["Recipient", item.maskedRecipient],
                ["Source", SOURCE_LABEL[item.source]],
                ["ID printed on letter", item.printedEmployeeCode ?? "None found"],
                ["Acceptance evidence", item.acceptanceEvidence === "NONE" ? "None — unknown" : "Note on file"],
                ["Possible duplicate of", item.possibleDuplicateOf ?? "—"],
              ]}
            />
            {item.status === "UNVERIFIED" && (
              <div className={styles.actions}>
                <button type="button" className={styles.secondary} onClick={() => openMode({ itemId: item.id, kind: "link" })}>Link to an existing ID</button>
                <button type="button" className={styles.secondary} onClick={() => openMode({ itemId: item.id, kind: "duplicate" })}>Mark as duplicate / forward</button>
                <button type="button" className={styles.secondary} onClick={() => openMode({ itemId: item.id, kind: "create" })}>No earlier record found…</button>
              </div>
            )}

            {mode?.itemId === item.id && mode.kind === "link" && (
              <div className={`${styles.subform} ${styles.stack}`}>
                <label>
                  <span>Employee ID from the original letter or the employee list</span>
                  <input value={personRef} onChange={(event) => setPersonRef(event.target.value)} placeholder="FQ-FE-00123" autoComplete="off" />
                </label>
                <div className={styles.actions}>
                  <button type="button" className={styles.primary} onClick={() => void link(item)}>Link</button>
                  <button type="button" className={styles.secondary} onClick={() => setMode(null)}>Cancel</button>
                </div>
              </div>
            )}

            {mode?.itemId === item.id && mode.kind === "duplicate" && (
              <div className={`${styles.subform} ${styles.stack}`}>
                <label>
                  <span>This is a forward / resend of</span>
                  <select value={duplicateOf} onChange={(event) => setDuplicateOf(event.target.value)}>
                    <option value="">Choose the original item</option>
                    {items.filter((other) => other.id !== item.id).map((other) => (
                      <option key={other.id} value={other.id}>{`${formatDay(other.sentOn)} · ${other.maskedRecipient}`}</option>
                    ))}
                  </select>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!duplicateOf}
                    onClick={() => void act({ itemId: item.id, duplicateOf }, (key) => api.markReconciliationDuplicate(item.id, duplicateOf, key), "Marked as a duplicate. No second person was created.")}
                  >
                    Mark as duplicate
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setMode(null)}>Cancel</button>
                </div>
              </div>
            )}

            {mode?.itemId === item.id && mode.kind === "create" && (
              <div className={`${styles.subform} ${styles.stack}`}>
                <Banner kind="warn">A new permanent employee ID is allocated only if no earlier ID exists. Check the employee list, the original letter and earlier offers first.</Banner>
                <label className={styles.checkRow}>
                  <input type="checkbox" checked={historyChecked} onChange={(event) => setHistoryChecked(event.target.checked)} />
                  <span>I checked the history and found no earlier employee ID for this person.</span>
                </label>
                <div className={styles.actions}>
                  <button
                    type="button"
                    className={styles.primary}
                    disabled={!historyChecked}
                    onClick={() => void act({ itemId: item.id, create: true }, (key) => api.createReconciliationIdentity(item.id, true, key), "New identity created from this letter.")}
                  >
                    Create identity
                  </button>
                  <button type="button" className={styles.secondary} onClick={() => setMode(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {!loading && items.length === 0 && !error && <p className={styles.muted}>Nothing to reconcile for this filter.</p>}
      {cursor && (
        <div className={styles.actions} style={{ marginTop: 12 }}>
          <button type="button" className={styles.secondary} disabled={loading} onClick={() => { setLoading(true); void loadMore(cursor); }}>{loading ? "Loading…" : "Load more"}</button>
        </div>
      )}
    </section>
  );
}
