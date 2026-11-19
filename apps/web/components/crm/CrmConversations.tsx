"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  SALES_COACH_CRITERIA,
  SALES_CONSENT_STATEMENT,
  SALES_RECORDING_MAX_BYTES,
  SALES_RECORDING_MAX_SECONDS,
  type SalesRecordingDto,
} from "@barbercue/shared";
import { apiFetch, apiFetchBlob } from "../../lib/api";
import { errorText, jsonBody, newSubmissionKey, pretty, queryParam, useCrmData, useQueryFlag, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { LeadPicker, type LeadRef } from "./CrmForms";
import { Dialog, Empty, Field, Pill } from "./ui";
import s from "./crm.module.css";

interface AiStatus {
  provider: string;
  configured: boolean;
  enabled: boolean;
  message: string;
  costPerMillionTokensUsd: number | null;
  retentionDays: number;
  usage: Array<{ status: string; count: number; estimatedCostUsd: string | null }> | null;
}

const CONSENT_LABEL: Record<string, string> = {
  VERBAL_ON_RECORDING: "Verbal consent, repeated at the start of the recording",
  WRITTEN_SIGNED: "Written / signed consent",
  WHATSAPP_CONFIRMATION: "WhatsApp confirmation",
};
const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

/** Sales conversations: consented recordings, private playback, AI coach status (never invented). */
export function CrmConversations() {
  const me = useMe();
  const ai = useCrmData<AiStatus>("crm/ai/status").data;
  const { data, error, reload } = useCrmData<SalesRecordingDto[]>("crm/recordings");
  const [recording, setRecording] = useQueryFlag("new");
  const [open, setOpen] = useState<SalesRecordingDto | null>(null);
  // Deep link (?recording=id from a notification): open it once the list has loaded.
  const [wanted, setWanted] = useState<string | null>(() => queryParam("recording"));
  const linked = wanted ? data?.find((x) => x.id === wanted) : undefined;
  if (linked) {
    setWanted(null);
    setOpen(linked);
  }
  return (
    <>
      <section className={s.card} style={{ marginBottom: 16 }} aria-label="AI sales coach status">
        <div className={s.cardHead}>
          <h2 className={s.cardTitle}>AI sales coach</h2>
          {ai && <Pill tone={ai.configured && ai.enabled ? "ok" : "warn"}>{ai.message}</Pill>}
        </div>
        {ai && !ai.configured && <p className={s.muted}>Recordings are stored privately and can be played back and reviewed by your manager. No scores are shown until an AI provider is configured by an administrator.</p>}
        {ai && <p className={s.faint}>Recordings are deleted automatically after {ai.retentionDays} days.{ai.costPerMillionTokensUsd ? ` Estimated AI cost: $${ai.costPerMillionTokensUsd} per million tokens.` : ""}</p>}
        {ai?.usage && ai.usage.length > 0 && (
          <p className={s.faint}>Analyses: {ai.usage.map((u) => `${pretty(u.status)} ${u.count}${u.estimatedCostUsd ? ` ($${u.estimatedCostUsd})` : ""}`).join(" · ")}</p>
        )}
      </section>
      <div className={s.toolbar}>
        {me?.role === "FIELD_EMPLOYEE" && <button type="button" className={`${s.btn} ${s.btnPrimary}`} onClick={() => setRecording(true)}>🎙 Record a conversation</button>}
      </div>
      {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
      {!data ? <div className={s.skel} /> : data.length === 0 ? <Empty>No conversations recorded yet.</Empty> : (
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead><tr><th>When</th><th>Salon</th>{me?.can.viewTeam && <th>Employee</th>}<th>Length</th><th>Consent</th><th>AI</th><th /></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td>{when(r.createdAt)}</td>
                  <td>{r.lead.shopName}</td>
                  {me?.can.viewTeam && <td>{r.employee.fullName}</td>}
                  <td>{fmt(r.durationSeconds)}</td>
                  <td>{pretty(r.consentMethod)}</td>
                  <td><AiPill r={r} /></td>
                  <td><button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => setOpen(r)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recording && <RecorderDialog onClose={() => setRecording(false)} onSaved={() => { setRecording(false); reload(); }} />}
      {open && <RecordingDialog rec={open} ai={ai} onClose={() => setOpen(null)} onChanged={(r) => { setOpen(r); reload(); }} onDeleted={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function AiPill({ r }: { r: SalesRecordingDto }) {
  if (r.deleted) return <Pill tone="bad">Audio deleted</Pill>;
  if (r.analysisStatus === "COMPLETED" && r.analysis?.overallScore != null) return <Pill tone="ok">{r.analysis.correctedScore ?? r.analysis.overallScore}/100</Pill>;
  if (r.analysisStatus === "NOT_CONFIGURED") return <Pill>AI Analysis Not Configured</Pill>;
  return <Pill tone={r.analysisStatus === "FAILED" ? "bad" : "warn"}>{pretty(r.analysisStatus)}</Pill>;
}

// ---------- Recorder ----------

type Phase = "consent" | "ready" | "recording" | "paused" | "done" | "uploading";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m));
}

function RecorderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [lead, setLead] = useState<LeadRef | null>(null);
  const meetingId = useState(() => queryParam("meeting"))[0];
  const [consent, setConsent] = useState({ given: false, method: "VERBAL_ON_RECORDING", participants: "", language: "hi-IN" });
  const [consentAt, setConsentAt] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("consent");
  const [seconds, setSeconds] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submissionKey = useRef(newSubmissionKey("rec"));
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Prefill lead from ?lead= (e.g. "Record conversation" on a meeting).
  useEffect(() => {
    const id = queryParam("lead");
    if (id) apiFetch<{ id: string; shopName: string }>(`crm/leads/${id}`).then((l) => setLead({ id: l.id, shopName: l.shopName })).catch(() => undefined);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => {
    if (seconds >= SALES_RECORDING_MAX_SECONDS && phase === "recording") stop();
  });

  const tick = () => {
    timer.current = setInterval(() => setSeconds((x) => x + 1), 1000);
  };
  const halt = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  function confirmConsent(e: FormEvent) {
    e.preventDefault();
    if (!lead) return setErr("Pick the salon you are speaking with.");
    if (!consent.given) return setErr("You must confirm consent before recording.");
    setErr(null);
    setConsentAt(new Date().toISOString());
    setPhase("ready");
  }
  async function start() {
    setErr(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setErr("This browser cannot record audio. Use Chrome on Android or Safari 14.5+ on iPhone.");
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return setErr("Microphone permission was denied. Allow microphone access in your browser settings and try again.");
    }
    const mimeType = pickMime();
    const r = new MediaRecorder(stream.current, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    chunks.current = [];
    r.ondataavailable = (ev) => ev.data.size > 0 && chunks.current.push(ev.data);
    r.onstop = () => {
      const b = new Blob(chunks.current, { type: r.mimeType || mimeType || "audio/webm" });
      setBlob(b);
      setUrl(URL.createObjectURL(b));
      stream.current?.getTracks().forEach((t) => t.stop());
      setPhase("done");
    };
    r.start(1000);
    rec.current = r;
    setSeconds(0);
    tick();
    setPhase("recording");
  }
  function pause() {
    rec.current?.pause();
    halt();
    setPhase("paused");
  }
  function resume() {
    rec.current?.resume();
    tick();
    setPhase("recording");
  }
  function stop() {
    halt();
    if (rec.current && rec.current.state !== "inactive") rec.current.stop();
  }
  function discard() {
    setBlob(null);
    setUrl(null);
    setSeconds(0);
    submissionKey.current = newSubmissionKey("rec");
    setPhase("ready");
  }
  async function upload() {
    if (!blob || !lead || !consentAt) return;
    if (blob.size > SALES_RECORDING_MAX_BYTES) return setErr("This recording is larger than 40 MB. Record shorter conversations.");
    setPhase("uploading");
    setErr(null);
    const fd = new FormData();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    fd.append("audio", blob, `conversation.${ext}`);
    fd.append("leadId", lead.id);
    if (meetingId) fd.append("meetingId", meetingId);
    fd.append("durationSeconds", String(Math.max(1, seconds)));
    fd.append("language", consent.language);
    fd.append("consentGiven", "true");
    fd.append("consentMethod", consent.method);
    fd.append("consentAt", consentAt);
    if (consent.participants.trim()) fd.append("participants", consent.participants.trim());
    fd.append("submissionKey", submissionKey.current);
    try {
      await apiFetch<SalesRecordingDto>("crm/recordings", { method: "POST", body: fd });
      onSaved();
    } catch (ex) {
      setErr(`${errorText(ex, "Upload failed.")} Your recording is still here — tap Upload to retry.`);
      setPhase("done");
    }
  }
  const busy = phase === "recording" || phase === "paused" || phase === "uploading";

  return (
    <Dialog title="Record sales conversation" onClose={() => { if (!busy || window.confirm("Stop and discard this recording?")) { stop(); onClose(); } }}>
      {phase === "consent" ? (
        <form className={s.form} onSubmit={confirmConsent}>
          <Field label="Salon"><LeadPicker value={lead} onChange={setLead} /></Field>
          <Field label="How was consent given?">
            <select className={s.select} value={consent.method} onChange={(e) => setConsent((c) => ({ ...c, method: e.target.value }))}>
              {Object.entries(CONSENT_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <div className={s.formGrid}>
            <Field label="People present"><input className={s.input} maxLength={300} placeholder="e.g. Ramesh (owner), Sunita (manager)" value={consent.participants} onChange={(e) => setConsent((c) => ({ ...c, participants: e.target.value }))} /></Field>
            <Field label="Language">
              <select className={s.select} value={consent.language} onChange={(e) => setConsent((c) => ({ ...c, language: e.target.value }))}>
                <option value="hi-IN">Hindi</option>
                <option value="en-IN">English</option>
                <option value="hinglish">Hinglish</option>
              </select>
            </Field>
          </div>
          <label className={s.check}><input type="checkbox" checked={consent.given} onChange={(e) => setConsent((c) => ({ ...c, given: e.target.checked }))} /> {SALES_CONSENT_STATEMENT}</label>
          {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
          <button type="submit" className={`${s.btn} ${s.btnPrimary}`}>Continue</button>
        </form>
      ) : (
        <div className={s.recorder}>
          <p className={s.muted}>{lead?.shopName} · consent confirmed {when(consentAt)}</p>
          <div className={s.timer} aria-live="polite">{fmt(seconds)}</div>
          {phase === "ready" && <button type="button" className={s.recBtn} onClick={() => void start()} aria-label="Start recording">●</button>}
          {(phase === "recording" || phase === "paused") && (
            <>
              <button type="button" className={`${s.recBtn} ${phase === "recording" ? s.recLive : ""}`} onClick={stop} aria-label="Stop recording">■</button>
              <div className={s.toolbar} style={{ marginBottom: 0 }}>
                {phase === "recording" ? <button type="button" className={s.btn} onClick={pause}>Pause</button> : <button type="button" className={s.btn} onClick={resume}>Resume</button>}
                <button type="button" className={s.btn} onClick={stop}>Stop</button>
              </div>
              <p className={s.faint}>{phase === "paused" ? "Paused." : "Recording… stop immediately if anyone withdraws consent."}</p>
            </>
          )}
          {(phase === "done" || phase === "uploading") && url && (
            <>
              <audio controls src={url} style={{ width: "100%" }} />
              <p className={s.faint}>{(blob!.size / 1024 / 1024).toFixed(1)} MB</p>
              <div className={s.toolbar} style={{ marginBottom: 0 }}>
                <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={phase === "uploading"} onClick={() => void upload()}>{phase === "uploading" ? "Uploading…" : "Upload"}</button>
                <button type="button" className={s.btn} disabled={phase === "uploading"} onClick={discard}>Discard & re-record</button>
              </div>
            </>
          )}
          {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        </div>
      )}
    </Dialog>
  );
}

// ---------- Detail ----------

function RecordingDialog({ rec, ai, onClose, onChanged, onDeleted }: { rec: SalesRecordingDto; ai: AiStatus | null; onClose: () => void; onChanged: (r: SalesRecordingDto) => void; onDeleted: () => void }) {
  const me = useMe();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState({ reviewerNotes: rec.analysis?.reviewerNotes ?? "", correctedScore: rec.analysis?.correctedScore != null ? String(rec.analysis.correctedScore) : "" });
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  const report = rec.analysisStatus === "COMPLETED" ? rec.analysis?.report ?? null : null;

  async function load() {
    try {
      const { blob } = await apiFetchBlob(`crm/recordings/${rec.id}/audio`);
      setAudioUrl(URL.createObjectURL(blob));
    } catch (ex) {
      setErr(errorText(ex));
    }
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (ex) {
      setErr(errorText(ex));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`${rec.lead.shopName} — ${when(rec.createdAt)}`} onClose={onClose}>
      <div className={s.form}>
        <p className={s.muted}>{rec.employee.fullName} · {fmt(rec.durationSeconds)} · {pretty(rec.language)} · consent: {CONSENT_LABEL[rec.consentMethod] ?? rec.consentMethod} ({when(rec.consentAt)}){rec.participants ? ` · ${rec.participants}` : ""}</p>
        {rec.deleted ? <p className={`${s.alert} ${s.alertInfo}`}>The audio was deleted.</p> : audioUrl ? <audio controls src={audioUrl} style={{ width: "100%" }} /> : <button type="button" className={s.btn} onClick={() => void load()}>▶ Load audio</button>}
        <h3 className={s.cardTitle}>AI analysis</h3>
        {!report ? (
          <>
            <p className={`${s.alert} ${s.alertInfo}`}>
              {ai && !ai.configured ? "AI Analysis Not Configured" : rec.analysisStatus === "FAILED" ? `Analysis failed${rec.analysis?.errorMessage ? `: ${rec.analysis.errorMessage}` : "."}` : pretty(rec.analysisStatus)}
            </p>
            {ai?.configured && ai.enabled && !rec.deleted && ["NOT_CONFIGURED", "FAILED", "DISABLED"].includes(rec.analysisStatus) && (
              <button type="button" className={`${s.btn} ${s.btnPrimary}`} disabled={busy} onClick={() => void act(async () => onChanged(await apiFetch<SalesRecordingDto>(`crm/recordings/${rec.id}/analyze`, { method: "POST", ...jsonBody({}) })))}>{rec.analysisStatus === "FAILED" ? "Retry analysis" : "Analyse"}</button>
            )}
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <span className={s.score}>{rec.analysis!.correctedScore ?? report.overallScore}</span>
              <span className={s.muted}>{report.summary}{rec.analysis!.correctedScore != null ? ` (manager-adjusted from ${report.overallScore})` : ""}</span>
            </div>
            {report.criteria.filter((c) => c.relevant).map((c) => (
              <div key={c.key}>
                <div className={s.listItem} style={{ border: 0, padding: 0 }}><span>{SALES_COACH_CRITERIA.find(([k]) => k === c.key)?.[1] ?? c.key}</span><strong>{c.score ?? "—"}</strong></div>
                <div className={s.bar}><i style={{ width: `${c.score ?? 0}%` }} /></div>
                {c.note && <div className={s.faint}>{c.note}</div>}
              </div>
            ))}
            {(
              [
                ["Strengths", report.strengths],
                ["Missed points", report.missedPoints],
                ["Owner questions", report.ownerQuestions],
                ["Unanswered questions", report.unansweredQuestions],
                ["Next steps", report.nextSteps],
                ["Coaching", report.coaching],
              ] as Array<[string, string[]]>
            ).filter(([, v]) => v.length).map(([k, v]) => (
              <div key={k}><strong>{k}</strong><ul>{v.map((x, i) => <li key={i} className={s.muted}>{x}</li>)}</ul></div>
            ))}
            {report.objections.length > 0 && (
              <div><strong>Objections</strong><ul>{report.objections.map((o, i) => <li key={i} className={s.muted}>{o.objection} — said: {o.response}. Better: {o.betterAnswer}</li>)}</ul></div>
            )}
            {me?.can.reviewRecordings && (
              <form className={s.form} onSubmit={(e) => { e.preventDefault(); void act(async () => onChanged(await apiFetch<SalesRecordingDto>(`crm/recordings/${rec.id}/review`, { method: "PATCH", ...jsonBody({ reviewerNotes: review.reviewerNotes || null, correctedScore: review.correctedScore ? Number(review.correctedScore) : null }) }))); }}>
                <h3 className={s.cardTitle}>Manager review</h3>
                <Field label="Corrected score (optional)"><input type="number" min={0} max={100} className={s.input} value={review.correctedScore} onChange={(e) => setReview((r) => ({ ...r, correctedScore: e.target.value }))} /></Field>
                <Field label="Notes for the employee"><textarea className={s.textarea} maxLength={2000} value={review.reviewerNotes} onChange={(e) => setReview((r) => ({ ...r, reviewerNotes: e.target.value }))} /></Field>
                <button type="submit" className={s.btn} disabled={busy}>Save review</button>
              </form>
            )}
          </>
        )}
        {rec.analysis?.reviewerNotes && !me?.can.reviewRecordings && <p className={`${s.alert} ${s.alertInfo}`}>Manager notes: {rec.analysis.reviewerNotes}</p>}
        {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
        {!rec.deleted && me?.role !== "VIEWER" && (
          <button type="button" className={`${s.btn} ${s.btnDanger}`} disabled={busy} onClick={() => window.confirm("Delete this recording's audio permanently? The record stays for the audit trail.") && void act(async () => { await apiFetch(`crm/recordings/${rec.id}`, { method: "DELETE" }); onDeleted(); })}>Delete audio</button>
        )}
      </div>
    </Dialog>
  );
}
