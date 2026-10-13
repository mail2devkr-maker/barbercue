"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  EMPLOYEE_PATHS,
  Role,
  parseVoiceOnboardingTranscript,
  type EmployeeVoiceLanguage,
  type EmployeeVoiceVisitLogDto,
  type EmployeeVoiceVisitLogPageDto,
  type VoiceOnboardingDraft,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";
import styles from "./voice-onboarding.module.css";

interface SpeechResultLike {
  isFinal: boolean;
  [index: number]: { transcript: string };
}

interface SpeechEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

const EMPLOYEE_BASE = EMPLOYEE_PATHS.employee;
type RecognizedChunk = { text: string; final: boolean };

function blankDraft(leadShopName: string): VoiceOnboardingDraft {
  return {
    shopName: leadShopName,
    ownerName: null,
    mobile: null,
    address: null,
    city: null,
    locality: null,
    chairs: null,
    staffCount: null,
    services: [],
    notes: null,
  };
}

function newSubmissionKey(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function message(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function EmployeeVoiceOnboardingPage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const router = useRouter();
  const { user, status } = useAuth();
  const [page, setPage] = useState<EmployeeVoiceVisitLogPageDto | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [logs, setLogs] = useState<EmployeeVoiceVisitLogDto[]>([]);
  const [activeLog, setActiveLog] = useState<EmployeeVoiceVisitLogDto | null>(
    null,
  );
  const [submissionKey, setSubmissionKey] = useState("");
  const [transcript, setTranscript] = useState("");
  const [language, setLanguage] = useState<EmployeeVoiceLanguage>("hi-IN");
  const [draft, setDraft] = useState<VoiceOnboardingDraft>(() =>
    blankDraft(""),
  );
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [speechSupported, setSpeechSupported] = useState<boolean | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const finalTranscriptRef = useRef("");
  const recognitionBaseRef = useRef("");
  const recognizedChunksRef = useRef<RecognizedChunk[]>([]);

  const endpoint = `${EMPLOYEE_BASE}/${EMPLOYEE_PATHS.leads}/${leadId}/${EMPLOYEE_PATHS.voiceVisitLogs}`;

  const refreshHistory = useCallback(
    async (cursor?: string) => {
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const result = await apiFetch<EmployeeVoiceVisitLogPageDto>(
        `${endpoint}?limit=20${suffix}`,
      );
      setPage(result);
      setNextCursor(result.nextCursor);
      setLogs((current) =>
        cursor ? [...current, ...result.items] : result.items,
      );
    },
    [endpoint],
  );

  useEffect(() => {
    if (status === "loading") return;
    if (
      status !== "authenticated" ||
      !user?.roles.includes(Role.FIELD_EXECUTIVE)
    ) {
      router.replace("/employee/login");
      return;
    }
    let cancelled = false;
    // The helper updates state only after its awaited API response; this effect owns its cancellation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshHistory()
      .catch((requestError: unknown) => {
        if (!cancelled)
          setError(
            message(requestError, "Could not load this lead's visit history."),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshHistory, router, status, user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    return () => recognitionRef.current?.abort();
  }, []);

  const confirmed = activeLog?.status === "CONFIRMED";
  const serviceTotal = useMemo(
    () => draft.services.length,
    [draft.services.length],
  );

  function startNewDraft() {
    if (!page) return;
    setActiveLog(null);
    setSubmissionKey(newSubmissionKey());
    setTranscript("");
    finalTranscriptRef.current = "";
    setInterim("");
    setLanguage("hi-IN");
    setDraft(blankDraft(page.lead.shopName));
    setReviewed(false);
    setNotice(
      "New visit draft ready. Nothing is saved until you choose Save draft.",
    );
    setError(null);
  }

  function resumeDraft(log: EmployeeVoiceVisitLogDto) {
    if (log.status !== "DRAFT") return;
    recognitionRef.current?.abort();
    setListening(false);
    setActiveLog(log);
    setSubmissionKey("");
    setTranscript(log.transcript);
    finalTranscriptRef.current = log.transcript;
    setInterim("");
    setLanguage(log.language);
    setDraft(log.structuredDraft);
    setReviewed(false);
    setNotice(`Draft resumed · last saved ${displayTime(log.updatedAt)}.`);
    setError(null);
  }

  function beginRecognition(retry = false) {
    const speechWindow = window as SpeechRecognitionWindow;
    const Recognition =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    setSpeechSupported(!!Recognition);
    if (!Recognition) {
      setError(
        "Speech recognition is not available in this browser. Type the transcript below instead.",
      );
      return;
    }
    recognitionRef.current?.abort();
    if (retry) {
      setTranscript("");
      finalTranscriptRef.current = "";
      recognitionBaseRef.current = "";
      setInterim("");
    } else {
      recognitionBaseRef.current = transcript;
    }
    recognizedChunksRef.current = [];
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = language;
    recognition.onresult = (event) => {
      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        const result = event.results[index];
        const phrase = result?.[0]?.transcript?.trim();
        if (!phrase) continue;
        recognizedChunksRef.current[index] = {
          text: phrase,
          final: result.isFinal,
        };
      }
      const finalParts = recognizedChunksRef.current
        .filter((chunk) => chunk?.final)
        .map((chunk) => chunk.text);
      const interimText = recognizedChunksRef.current
        .filter((chunk) => chunk && !chunk.final)
        .map((chunk) => chunk.text)
        .join(" ");
      const base = recognitionBaseRef.current.trim();
      const finalText = [base, ...finalParts].filter(Boolean).join(" ");
      finalTranscriptRef.current = finalText;
      setTranscript(finalText);
      setInterim(interimText);
    };
    recognition.onerror = (event) => {
      setListening(false);
      const detail =
        event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Microphone access was denied. Allow microphone permission in your browser, or type the transcript."
          : `Speech recognition stopped (${event.error}). Your typed transcript remains available.`;
      setError(detail);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      setTranscript(finalTranscriptRef.current);
    };
    recognitionRef.current = recognition;
    setError(null);
    try {
      recognition.start();
      setListening(true);
      setNotice(
        "Listening. Browser speech recognition may process audio through its speech service; FastQue does not record or save audio.",
      );
    } catch {
      setListening(false);
      setError(
        "The microphone could not be started. Check browser permission and try again, or type the transcript.",
      );
    }
  }

  function stopRecognition() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function extractFields() {
    setDraft(parseVoiceOnboardingTranscript(transcript));
    setReviewed(false);
    setNotice(
      "Extracted values are a draft only. Review and correct every field before confirming.",
    );
  }

  function updateDraft<K extends keyof VoiceOnboardingDraft>(
    key: K,
    value: VoiceOnboardingDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setReviewed(false);
  }

  async function save(statusToSave: "DRAFT" | "CONFIRMED") {
    if (!transcript.trim()) {
      setError("Add or dictate a transcript before saving the visit.");
      return;
    }
    if (statusToSave === "CONFIRMED" && !reviewed) {
      setError(
        "Review the extracted details and confirm the review checkbox before final save.",
      );
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      let saved = activeLog;
      if (!saved) {
        saved = await apiFetch<EmployeeVoiceVisitLogDto>(endpoint, {
          method: "POST",
          body: JSON.stringify({
            submissionKey,
            transcript,
            language,
            structuredDraft: draft,
          }),
        });
        setActiveLog(saved);
        setSubmissionKey("");
      }
      const result = await apiFetch<EmployeeVoiceVisitLogDto>(
        `${endpoint}/${saved.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            transcript,
            language,
            structuredDraft: draft,
            status: statusToSave,
            reviewAcknowledged: statusToSave === "CONFIRMED" && reviewed,
          }),
        },
      );
      setActiveLog(result);
      setTranscript(result.transcript);
      finalTranscriptRef.current = result.transcript;
      setDraft(result.structuredDraft);
      setLanguage(result.language);
      setLogs((current) => [
        result,
        ...current.filter((item) => item.id !== result.id),
      ]);
      setReviewed(false);
      setNotice(
        statusToSave === "CONFIRMED"
          ? "Visit log confirmed and saved. This does not publish services or prices to a live salon."
          : "Draft saved. You can return to this lead and resume it later.",
      );
    } catch (requestError) {
      setError(
        message(
          requestError,
          "Could not save this visit log. Your text is still on this screen.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || loading || page?.lead.id !== leadId) {
    return (
      <main className={styles.page}>
        <p className={styles.muted}>Loading lead history…</p>
      </main>
    );
  }
  if (!page) {
    return (
      <main className={styles.page}>
        <Link href="/employee">← Employee CRM</Link>
        <p role="alert" className={styles.error}>
          {error ?? "Lead unavailable."}
        </p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <Link className={styles.back} href="/employee">
          ← Employee CRM
        </Link>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Field visit · voice onboarding</p>
            <h1>{page.lead.shopName}</h1>
            <p className={styles.sub}>
              Capture what the owner tells you. The lead is checked against your
              employee account on every request.
            </p>
          </div>
          <button
            type="button"
            className={styles.primary}
            onClick={() => {
              if (
                (activeLog || submissionKey) &&
                !confirmed &&
                !window.confirm(
                  "Start a new visit draft? Save this draft first if you need to keep your latest edits.",
                )
              )
                return;
              startNewDraft();
            }}
          >
            {activeLog ? "Start another visit" : "Start voice onboarding"}
          </button>
        </header>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}

        {activeLog || submissionKey ? (
          <section className={styles.panel} aria-label="Voice visit editor">
            <div className={styles.panelHeader}>
              <div>
                <h2>
                  {confirmed
                    ? "Confirmed field visit"
                    : activeLog
                      ? "Resume visit draft"
                      : "New visit draft"}
                </h2>
                <span>
                  {confirmed ? "Read-only record" : "Review before confirming"}
                </span>
              </div>
              {activeLog && (
                <time dateTime={activeLog.updatedAt}>
                  Saved {displayTime(activeLog.updatedAt)}
                </time>
              )}
            </div>

            <div className={styles.voiceBar}>
              <label>
                Speech language
                <select
                  value={language}
                  disabled={confirmed || listening}
                  onChange={(event) =>
                    setLanguage(event.target.value as EmployeeVoiceLanguage)
                  }
                >
                  <option value="hi-IN">Hindi / Hinglish</option>
                  <option value="en-IN">English (India)</option>
                </select>
              </label>
              {listening ? (
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={stopRecognition}
                >
                  Stop
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={confirmed}
                  onClick={() => beginRecognition()}
                >
                  Start microphone
                </button>
              )}
              <button
                type="button"
                className={styles.secondary}
                disabled={confirmed || listening}
                onClick={() => beginRecognition(true)}
              >
                Retry
              </button>
              <span
                className={listening ? styles.listening : styles.muted}
                aria-live="polite"
              >
                {listening
                  ? "Listening…"
                  : speechSupported === true
                    ? "Browser speech available"
                    : speechSupported === false
                      ? "Manual typing available"
                      : "Manual typing available · speech checked on start"}
              </span>
            </div>
            <p className={styles.privacy}>
              Microphone access is requested only when you start. Browser speech
              recognition may send audio to the browser’s speech service.
              FastQue does not record or store raw audio; only the transcript
              and reviewed draft are saved.
            </p>

            <label className={styles.field}>
              Original transcript
              <textarea
                aria-label="Original transcript"
                value={transcript}
                disabled={confirmed}
                onChange={(event) => {
                  setTranscript(event.target.value);
                  finalTranscriptRef.current = event.target.value;
                  setReviewed(false);
                }}
                placeholder="Speak, or type the visit notes here if speech recognition is unavailable."
              />
            </label>
            {interim && (
              <p className={styles.interim} aria-live="polite">
                Live: {interim}
              </p>
            )}
            <div className={styles.extractRow}>
              <button
                type="button"
                className={styles.secondary}
                disabled={confirmed || !transcript.trim()}
                onClick={extractFields}
              >
                Extract fields from transcript
              </button>
              <span>
                Extraction is heuristic; blank or uncertain values stay blank
                for you to correct.
              </span>
            </div>

            <div className={styles.fields}>
              <label className={styles.field}>
                Salon name
                <input
                  value={draft.shopName}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("shopName", event.target.value)
                  }
                />
              </label>
              <label className={styles.field}>
                Owner name
                <input
                  value={draft.ownerName ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("ownerName", event.target.value || null)
                  }
                />
              </label>
              <label className={styles.field}>
                Mobile number
                <input
                  inputMode="tel"
                  value={draft.mobile ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("mobile", event.target.value || null)
                  }
                />
              </label>
              <label className={styles.field}>
                Address
                <input
                  value={draft.address ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("address", event.target.value || null)
                  }
                />
              </label>
              <label className={styles.field}>
                City
                <input
                  value={draft.city ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("city", event.target.value || null)
                  }
                />
              </label>
              <label className={styles.field}>
                Locality / area
                <input
                  value={draft.locality ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft("locality", event.target.value || null)
                  }
                />
              </label>
              <label className={styles.field}>
                Number of chairs
                <input
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="500"
                  value={draft.chairs ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft(
                      "chairs",
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
              </label>
              <label className={styles.field}>
                Number of staff
                <input
                  inputMode="numeric"
                  type="number"
                  min="0"
                  max="500"
                  value={draft.staffCount ?? ""}
                  disabled={confirmed}
                  onChange={(event) =>
                    updateDraft(
                      "staffCount",
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                    )
                  }
                />
              </label>
            </div>

            <section
              className={styles.services}
              aria-label="Services and prices"
            >
              <div className={styles.panelHeader}>
                <div>
                  <h3>Services and quoted prices</h3>
                  <span>{serviceTotal} rows · draft only</span>
                </div>
                {!confirmed && (
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() =>
                      updateDraft("services", [
                        ...draft.services,
                        { name: "", priceRupees: null },
                      ])
                    }
                  >
                    Add service
                  </button>
                )}
              </div>
              {draft.services.length === 0 && (
                <p className={styles.muted}>
                  No services extracted. Add only what the owner quoted; leave
                  price blank if not stated.
                </p>
              )}
              {draft.services.map((service, index) => (
                <div
                  className={styles.serviceRow}
                  key={`${index}-${service.name}`}
                >
                  <label className={styles.field}>
                    Service
                    <input
                      value={service.name}
                      disabled={confirmed}
                      onChange={(event) =>
                        updateDraft(
                          "services",
                          draft.services.map((item, i) =>
                            i === index
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    Price (₹)
                    <input
                      inputMode="decimal"
                      type="number"
                      min="0"
                      max="1000000"
                      step="0.01"
                      value={service.priceRupees ?? ""}
                      disabled={confirmed}
                      onChange={(event) =>
                        updateDraft(
                          "services",
                          draft.services.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  priceRupees:
                                    event.target.value === ""
                                      ? null
                                      : Number(event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                  </label>
                  {!confirmed && (
                    <button
                      aria-label={`Remove ${service.name || "service"}`}
                      type="button"
                      className={styles.smallButton}
                      onClick={() =>
                        updateDraft(
                          "services",
                          draft.services.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </section>

            <label className={styles.field}>
              Other visit notes
              <textarea
                value={draft.notes ?? ""}
                disabled={confirmed}
                onChange={(event) =>
                  updateDraft("notes", event.target.value || null)
                }
              />
            </label>

            {!confirmed && (
              <label className={styles.reviewCheck}>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(event) => setReviewed(event.target.checked)}
                />{" "}
                I reviewed the transcript and corrected the structured details.
                These are field notes only, not a live salon service catalog.
              </label>
            )}
            {!confirmed && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy || listening}
                  onClick={() => void save("DRAFT")}
                >
                  {busy ? "Saving…" : "Save draft"}
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={busy || listening || !reviewed}
                  onClick={() => void save("CONFIRMED")}
                >
                  {busy ? "Saving…" : "Confirm and save visit"}
                </button>
                <span>
                  Review checkbox required for final save. Duplicate taps are
                  ignored while saving.
                </span>
              </div>
            )}
          </section>
        ) : null}

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Shop visit history</h2>
              <span>
                Employee: {user?.email ?? "Signed-in field executive"} ·{" "}
                {logs.length} loaded
              </span>
            </div>
          </div>
          {logs.length === 0 && (
            <p className={styles.muted}>
              No voice visit drafts or confirmed logs for this lead yet.
            </p>
          )}
          <div className={styles.history}>
            {logs.map((log) => (
              <article className={styles.historyCard} key={log.id}>
                <div>
                  <strong>
                    {log.status === "DRAFT"
                      ? "Unfinished draft"
                      : "Confirmed visit"}
                  </strong>
                  <time dateTime={log.createdAt}>
                    {displayTime(log.createdAt)}
                  </time>
                </div>
                <p>{log.transcript}</p>
                <small>
                  {log.employee.fullName} · {log.employee.employeeCode} ·{" "}
                  {log.structuredDraft.services.length} service rows
                </small>
                {log.status === "DRAFT" && (
                  <button
                    type="button"
                    className={styles.smallButton}
                    onClick={() => resumeDraft(log)}
                  >
                    Resume draft
                  </button>
                )}
              </article>
            ))}
          </div>
          {nextCursor && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                void refreshHistory(nextCursor).catch((requestError: unknown) =>
                  setError(
                    message(requestError, "Could not load more visit history."),
                  ),
                )
              }
            >
              Load older visits
            </button>
          )}
        </section>
      </div>
    </main>
  );
}
