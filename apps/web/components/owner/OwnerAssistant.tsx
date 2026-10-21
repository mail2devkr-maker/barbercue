"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerAssistantQueryDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import {
  QUESTION_LIMITS,
  QUICK_QUESTIONS,
  describeFailure,
  formatFigure,
  metricLabel,
  parseAnswer,
  validateQuestion,
  type InsightFailure,
} from "../../lib/owner-assistant";
import { Badge, Banner, Btn, Card } from "./parts";
import styles from "./owner-assistant.module.css";

/**
 * Quick Insights: a fixed list of read-only questions about today or right now, answered from the shop's own recorded numbers.
 * It is deliberately not a chat and uses no AI: it never changes anything, never reads other shops, and an estimate is always
 * labelled as an estimate. A reply that does not have the documented shape is shown as "could not answer", never half-shown.
 */
export function OwnerAssistant({ salonId }: { salonId: string }) {
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<OwnerAssistantQueryDto | null>(null);
  const [failure, setFailure] = useState<InsightFailure | null>(null);
  // A second click or Enter while a question is being answered must not send it twice (the server allows 12 a minute).
  const inFlight = useRef(false);

  async function ask(question: string) {
    if (inFlight.current) return;
    const problem = validateQuestion(question);
    setFieldError(problem);
    if (problem) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setAsked(question.trim());
    try {
      const raw = await apiFetch<unknown>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/assistant/query`, {
        method: "POST",
        body: JSON.stringify({ question: question.trim() }),
      });
      const parsed = parseAnswer(raw);
      if (!parsed) {
        setAnswer(null);
        setFailure({ kind: "TRY_LATER", message: "Quick Insights could not answer right now. Nothing was changed. Try again in a moment." });
        return;
      }
      setAnswer(parsed);
    } catch (err) {
      // The earlier answer is dropped so an old number is never shown beside a new question.
      setAnswer(null);
      setFailure(err instanceof ApiError ? describeFailure(err.status, err.code, err.details) : describeFailure(undefined, undefined));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(text);
  }

  return (
    <>
      <Card title="Ask about your shop" sub="Pick a question, or type one of the same kind.">
        <p className={styles.notice}>
          Quick Insights answers a fixed set of questions from your shop&apos;s own recorded numbers. It is not a chat and does not use AI. It cannot change anything, and it
          never shows customer details.
        </p>
        <ul className={styles.chips} aria-label="Questions you can ask">
          {QUICK_QUESTIONS.map((q) => (
            <li key={q.intent}>
              <Btn
                small
                disabled={busy}
                onClick={() => {
                  setText(q.question);
                  void ask(q.question);
                }}
              >
                {q.label}
              </Btn>
            </li>
          ))}
        </ul>
        <form className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.fieldWrap}>
            <label htmlFor="owner-assistant-question" className={styles.asked}>
              Your question
            </label>
            <input
              id="owner-assistant-question"
              className={styles.input}
              type="text"
              value={text}
              maxLength={QUESTION_LIMITS.max}
              placeholder="For example: How many appointments today"
              autoComplete="off"
              aria-invalid={fieldError ? true : undefined}
              aria-describedby={fieldError ? "owner-assistant-question-error" : undefined}
              onChange={(e) => {
                setText(e.target.value);
                if (fieldError) setFieldError(null);
              }}
            />
            {fieldError && (
              <p id="owner-assistant-question-error" className={styles.fieldError} role="alert">
                {fieldError}
              </p>
            )}
          </div>
          <Btn type="submit" variant="primary" disabled={busy}>
            {busy ? "Asking…" : "Ask"}
          </Btn>
        </form>
      </Card>

      <div aria-live="polite" aria-atomic="true">
        {failure && (
          <Banner tone={failure.kind === "UNSUPPORTED" ? "warn" : "error"}>
            <div>{failure.message}</div>
            {failure.kind === "UNSUPPORTED" && (
              <ul className={styles.supported}>
                {(failure.supported.length > 0 ? failure.supported : QUICK_QUESTIONS.map((q) => q.label)).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            )}
          </Banner>
        )}
        {answer && (
          <Card title="Answer">
            {asked && <p className={styles.asked}>{`You asked: ${asked}`}</p>}
            <p className={styles.answer}>{answer.answer}</p>
            {answer.figures.length > 0 && (
              <ul className={styles.figures} aria-label="Figures behind this answer">
                {answer.figures.map((f) => (
                  <li key={f.metric} className={styles.figure}>
                    <span className={styles.figureLabel}>
                      {metricLabel(f.metric)} {f.estimated && <Badge tone="warn">Estimate</Badge>}
                    </span>
                    <span className={styles.figureValue}>{formatFigure(f)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className={styles.meta}>
              {`For ${answer.localDate} (${answer.timezone}). An estimate is the listed price of completed services. It is not money collected.`}
            </p>
          </Card>
        )}
      </div>
    </>
  );
}
