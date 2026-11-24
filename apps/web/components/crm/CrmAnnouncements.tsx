"use client";

import { useEffect, useState, type FormEvent } from "react";
import { CRM_VIDEO_MAX_BYTES, type CrmAnnouncementDto } from "@barbercue/shared";
import { apiFetch, apiFetchBlob } from "../../lib/api";
import { errorText, jsonBody, useCrmData, when } from "../../lib/crm";
import { useMe } from "./CrmShell";
import { Empty, Field, Pill } from "./ui";
import s from "./crm.module.css";

/** Uploaded video is private: it is fetched with the viewer's session only when they press play. */
function Video({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  if (url) return <video src={url} controls autoPlay playsInline style={{ width: "100%", maxHeight: 420, borderRadius: 14, background: "#000" }} />;
  return (
    <>
      <button
        type="button"
        className={`${s.btn} ${s.btnPrimary}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setErr(null);
          apiFetchBlob(`crm/announcements/${id}/video`)
            .then(({ blob }) => setUrl(URL.createObjectURL(blob)))
            .catch((ex) => setErr(errorText(ex, "Could not load the video.")))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Loading video…" : "▶ Play video"}
      </button>
      {err && <p className={`${s.alert} ${s.alertError}`} role="alert">{err}</p>}
    </>
  );
}

function Body({ m }: { m: CrmAnnouncementDto }) {
  return (
    <>
      {m.body && <p className={s.muted} style={{ whiteSpace: "pre-wrap" }}>{m.body}</p>}
      {m.hasVideo && <Video id={m.id} />}
      {m.videoUrl && <p><a className={s.link} href={m.videoUrl} target="_blank" rel="noopener noreferrer">Watch the video ↗</a></p>}
    </>
  );
}

/** Employee dashboard: the latest message from the CEO (nothing is shown when there is none). */
export function CeoMessage() {
  const { data } = useCrmData<CrmAnnouncementDto[]>("crm/announcements");
  const m = data?.find((x) => x.isActive);
  if (!m) return null;
  return (
    <section className={s.card} style={{ marginBottom: 16 }} aria-label="Message from the CEO">
      <div className={s.eyebrow}>Message from the CEO</div>
      <h2 className={s.cardTitle} style={{ margin: "6px 0" }}>{m.title}</h2>
      <Body m={m} />
      <p className={s.faint}>{when(m.createdAt)}</p>
    </section>
  );
}

/** Admin: write a message, attach a video file or link, show/hide or delete it. */
export function CeoMessageAdmin() {
  const me = useMe();
  const { data, error, reload } = useCrmData<CrmAnnouncementDto[]>("crm/announcements");
  const [form, setForm] = useState({ title: "", body: "", videoUrl: "" });
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (me && me.role !== "ADMIN") return <Empty>Only an administrator can manage CEO messages.</Empty>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!form.body.trim() && !form.videoUrl.trim() && !file) return setMsg({ ok: false, text: "Add a message, a video file or a video link." });
    if (file && file.size > CRM_VIDEO_MAX_BYTES) return setMsg({ ok: false, text: "The video is larger than 50 MB. Use a shorter video or paste a link." });
    setBusy(true);
    let created: CrmAnnouncementDto | null = null;
    try {
      created = await apiFetch<CrmAnnouncementDto>("crm/announcements", { method: "POST", ...jsonBody(form) });
      if (file) {
        const fd = new FormData();
        fd.append("video", file);
        await apiFetch(`crm/announcements/${created.id}/video`, { method: "POST", body: fd });
      }
      setForm({ title: "", body: "", videoUrl: "" });
      setFile(null);
      setInputKey((k) => k + 1);
      setMsg({ ok: true, text: "Published. Employees now see it on their dashboard." });
    } catch (ex) {
      // Do not leave a half-published message (without its video) on employee dashboards.
      if (created) await apiFetch(`crm/announcements/${created.id}`, { method: "DELETE" }).catch(() => undefined);
      setMsg({ ok: false, text: errorText(ex) });
    } finally {
      setBusy(false);
      reload();
    }
  }
  async function act(run: () => Promise<unknown>) {
    setMsg(null);
    try {
      await run();
      reload();
    } catch (ex) {
      setMsg({ ok: false, text: errorText(ex) });
    }
  }
  return (
    <div className={s.grid2}>
      <section className={s.card} aria-label="New CEO message">
        <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>New CEO message</h2>
        <form className={s.form} onSubmit={submit}>
          <Field label="Title"><input className={s.input} required maxLength={160} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
          <Field label="Message"><textarea className={s.textarea} maxLength={4000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} /></Field>
          <Field label="Video file (MP4, MOV or WebM, up to 50 MB)"><input key={inputKey} type="file" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <Field label="Or a video link (YouTube, Drive…)"><input className={s.input} inputMode="url" placeholder="https://" maxLength={500} value={form.videoUrl} onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))} /></Field>
          {msg && <p className={`${s.alert} ${msg.ok ? s.alertOk : s.alertError}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
          <button type="submit" className={`${s.btn} ${s.btnPrimary}`} disabled={busy}>{busy ? "Publishing…" : "Publish to employees"}</button>
        </form>
      </section>
      <section className={s.card} aria-label="Published messages">
        <h2 className={s.cardTitle} style={{ marginBottom: 10 }}>Messages</h2>
        <p className={s.faint}>Employees see the newest visible message.</p>
        {error && <p className={`${s.alert} ${s.alertError}`} role="alert">{error}</p>}
        {!data ? <div className={s.skel} /> : data.length === 0 ? <Empty>No messages yet.</Empty> : (
          <ul className={s.list}>
            {data.map((m) => (
              <li key={m.id} className={s.listItem} style={{ display: "block" }}>
                <div className={s.toolbar} style={{ justifyContent: "space-between" }}>
                  <strong>{m.title}</strong>
                  <Pill tone={m.isActive ? "ok" : undefined}>{m.isActive ? "Visible" : "Hidden"}</Pill>
                </div>
                <Body m={m} />
                <div className={s.faint}>{when(m.createdAt)}</div>
                <div className={s.toolbar} style={{ margin: "8px 0 0" }}>
                  <button type="button" className={`${s.btn} ${s.btnSm}`} onClick={() => void act(() => apiFetch(`crm/announcements/${m.id}`, { method: "PATCH", ...jsonBody({ isActive: !m.isActive }) }))}>{m.isActive ? "Hide" : "Show"}</button>
                  <button type="button" className={`${s.btn} ${s.btnSm} ${s.btnDanger}`} onClick={() => window.confirm("Delete this message and its video?") && void act(() => apiFetch(`crm/announcements/${m.id}`, { method: "DELETE" }))}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
