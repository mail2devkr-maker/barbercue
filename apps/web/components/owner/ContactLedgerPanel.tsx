"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContactLedgerSummaryDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { ledgerPath, parseErase, parseSummary, parseWithdraw } from "../../lib/contact-ledger";
import { Banner, Btn, Card, Field } from "./parts";
import ui from "./owner.module.css";

/**
 * Agreement records: how many people the shop has saved as having agreed, and the two things the shop must always be able to
 * do for a person: record that they asked to STOP, and ERASE the shop's record of their number. Neither sends anything, and
 * FastQue never shows a saved number back (it keeps only a scrambled fingerprint).
 */
export function ContactLedgerPanel({ salonId, refreshKey = 0 }: { salonId: string; /** Changes when something elsewhere on the page saved records, so the counts are read again. */ refreshKey?: number }) {
  const [summary, setSummary] = useState<ContactLedgerSummaryDto | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [everywhere, setEverywhere] = useState(false);
  const [keepStopList, setKeepStopList] = useState(true);
  const [confirmErase, setConfirmErase] = useState(false);
  const [busy, setBusy] = useState<"withdraw" | "erase" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<unknown>(ledgerPath(salonId, "/summary"))
      .then((raw) => {
        const parsed = parseSummary(raw);
        setSummary(parsed);
        setSummaryError(parsed ? null : "FastQue sent an answer this page could not read.");
      })
      .catch(() => {
        setSummary(null);
        setSummaryError("Could not load your saved records.");
      });
  }, [salonId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  function describe(err: unknown): string {
    if (err instanceof ApiError && err.status === 400) return "That is not a valid mobile number.";
    if (err instanceof ApiError && err.status === 429) return "You have done that a lot in a short time. Wait a minute and try again.";
    if (err instanceof ApiError && err.status === 503) return "Agreement records are not switched on for FastQue yet.";
    return err instanceof ApiError ? err.message : "That did not work. Nothing was changed.";
  }

  async function withdraw() {
    setBusy("withdraw");
    setError(null);
    setNotice(null);
    try {
      const raw = await apiFetch<unknown>(ledgerPath(salonId, "/withdraw"), { method: "POST", body: JSON.stringify({ phone, suppressEverywhere: everywhere }) });
      const result = parseWithdraw(raw);
      if (!result) setError("FastQue sent an answer this page could not read, so nothing is assumed to be changed.");
      else {
        setNotice(
          result.withdrawn
            ? result.suppressedEverywhere
              ? "Saved as asked to stop, and added to the list nobody on FastQue may contact."
              : "Saved as asked to stop."
            : result.suppressedEverywhere
              ? "No record of this number was found at your shop, and it is now on the list nobody on FastQue may contact."
              : "There was no active record of this number at your shop, so nothing changed.",
        );
        setPhone("");
        load();
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  }

  async function erase() {
    setBusy("erase");
    setError(null);
    setNotice(null);
    try {
      const raw = await apiFetch<unknown>(ledgerPath(salonId, "/erase"), { method: "POST", body: JSON.stringify({ phone, keepSuppression: keepStopList }) });
      const result = parseErase(raw);
      if (!result) setError("FastQue sent an answer this page could not read, so nothing is assumed to be erased.");
      else {
        setNotice(
          result.erased > 0
            ? result.suppressionKept
              ? "Your record of this number was erased. Only a do-not-contact marker is kept, so nobody contacts them by mistake."
              : "Your record of this number was erased completely."
            : result.suppressionKept
              ? "Your shop had no record of this number. A do-not-contact marker was kept."
              : "Your shop had no record of this number.",
        );
        setPhone("");
        setConfirmErase(false);
        load();
      }
    } catch (err) {
      setError(describe(err));
    } finally {
      setBusy(null);
    }
  }

  const hasPhone = phone.trim().length > 0;
  return (
    <div className={ui.mt16}>
      <Card title="Saved agreement records" sub="Counts only. FastQue does not show saved numbers back.">
        {summaryError && <Banner tone="warn">{summaryError}</Banner>}
        {summary && (
          <div className={ui.statGrid}>
            <div className={ui.stat}><div className={ui.statLabel}>Agreed</div><div className={ui.statValue}>{summary.active}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Asked to stop</div><div className={ui.statValue}>{summary.withdrawn}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Out of date</div><div className={ui.statValue}>{summary.expired}</div></div>
            <div className={ui.stat}><div className={ui.statLabel}>Run out within 30 days</div><div className={ui.statValue}>{summary.expiringWithin30Days}</div></div>
          </div>
        )}
        {summary && <p className={ui.cardSub}>Records are kept for {summary.retentionDays} days and then stop counting. Nothing can be sent from here.</p>}
      </Card>

      <div className={ui.mt16}>
        <Card title="Stop contacting someone, or erase a record" sub="Enter the phone number. Use this when a person asks you to stop, or asks you to delete what you hold about them.">
          <Field label="Phone number" htmlFor="ledger-phone">
            <input id="ledger-phone" className={ui.input} value={phone} onChange={(e) => { setPhone(e.target.value); setNotice(null); setError(null); }} inputMode="tel" autoComplete="off" spellCheck={false} maxLength={40} />
          </Field>
          <div className={ui.mt12}>
            <label className={ui.label}>
              <input id="ledger-everywhere" type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />{" "}
              Also make sure nobody on FastQue contacts this number
            </label>
          </div>
          <div className={ui.mt12}>
            <label className={ui.label}>
              <input id="ledger-keep" type="checkbox" checked={keepStopList} onChange={(e) => setKeepStopList(e.target.checked)} />{" "}
              When erasing, keep a do-not-contact marker (recommended)
            </label>
          </div>
          <div className={ui.mt12}>
            <label className={ui.label}>
              <input id="ledger-confirm" type="checkbox" checked={confirmErase} onChange={(e) => setConfirmErase(e.target.checked)} />{" "}
              I understand that erasing deletes my shop’s record of this number
            </label>
          </div>
          {error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
          {notice && <div className={ui.mt12} role="status"><Banner tone="info">{notice}</Banner></div>}
          <div className={`${ui.rowWrap} ${ui.mt12}`}>
            <Btn variant="primary" onClick={() => void withdraw()} disabled={!hasPhone || busy !== null}>{busy === "withdraw" ? "Saving…" : "They asked to stop"}</Btn>
            <Btn variant="quiet" onClick={() => void erase()} disabled={!hasPhone || !confirmErase || busy !== null}>{busy === "erase" ? "Erasing…" : "Erase my record"}</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}
