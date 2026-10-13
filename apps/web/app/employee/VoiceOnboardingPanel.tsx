"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  EMPLOYEE_PATHS,
  type CreateEmployeeVoiceLogInput,
  type EmployeeCrmLeadDto,
  type EmployeeVoiceOnboardingLogDto,
} from "@barbercue/shared";
import { ApiError, apiFetch } from "../../lib/api";
import { parseOnboardingServices, suggestOnboardingCounts } from "../../lib/employee-voice-parser";
import styles from "./voice-onboarding.module.css";

type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { results: ArrayLike<SpeechResult> };
type SpeechEngine = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechBrowser = Window & {
  SpeechRecognition?: new () => SpeechEngine;
  webkitSpeechRecognition?: new () => SpeechEngine;
};
type ServiceDraft = { id: string; name: string; price: string };

const API_PATH = `${EMPLOYEE_PATHS.employee}/${EMPLOYEE_PATHS.voiceLogs}`;
const newId = () => crypto.randomUUID();
const safeFileName = (value: string) =>
  value.replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").slice(0, 60) || "shop";

function downloadText(log: EmployeeVoiceOnboardingLogDto) {
  const services = log.services.map((item) => `- ${item.name}: INR ${item.priceInr}`).join("\n");
  const content = [
    "FASTQUE - INTERNAL FIELD ONBOARDING LOG (NOT A PUBLISHED SERVICE MENU)",
    `Shop: ${log.shopName}`,
    `Captured: ${log.createdAt}`,
    `CRM Lead ID: ${log.leadId ?? "Standalone"}`,
    `Contact: ${log.contactName ?? ""}`,
    `Phone: ${log.phone ?? ""}`,
    `City: ${log.city ?? ""}`,
    `Locality: ${log.locality ?? ""}`,
    `Address: ${log.addressLine ?? ""}`,
    `GPS: ${log.latitude ?? ""}, ${log.longitude ?? ""}`,
    `Chairs: ${log.chairCount ?? "Not confirmed"}`,
    `Staff: ${log.staffCount ?? "Not confirmed"}`,
    "", "REVIEWED PRICE ENTRIES (INR)", services || "No structured services saved",
    "", "VOICE / MANUAL TRANSCRIPT", log.transcript,
    "", "NOTES", log.notes ?? "",
    "", "Use only after verifying with the salon owner. Do not forward contact details without permission.",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `FastQue-${safeFileName(log.shopName)}-${log.id.slice(0, 8)}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VoiceOnboardingPanel({ leads }: { leads: EmployeeCrmLeadDto[] }) {
  const [history, setHistory] = useState<EmployeeVoiceOnboardingLogDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [leadId, setLeadId] = useState("");
  const [shopName, setShopName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [locality, setLocality] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [chairCount, setChairCount] = useState("");
  const [staffCount, setStaffCount] = useState("");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [unparsedNotice, setUnparsedNotice] = useState<string | null>(null);
  const engineRef = useRef<SpeechEngine | null>(null);
  const transcriptBaseRef = useRef("");
  const requestIdRef = useRef<string | null>(null);

  const loadHistory = useCallback(async () => {
    try {
      setHistory(await apiFetch<EmployeeVoiceOnboardingLogDto[]>(API_PATH));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load saved onboarding logs.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadHistory();
    return () => { engineRef.current?.stop(); };
  }, [loadHistory]);

  const recognitionAvailable = typeof window !== "undefined" &&
    Boolean((window as SpeechBrowser).SpeechRecognition || (window as SpeechBrowser).webkitSpeechRecognition);

  function stopMic() {
    engineRef.current?.stop();
    engineRef.current = null;
    setListening(false);
  }

  function startMic() {
    if (!consent) {
      setError("Please confirm the salon owner's permission before using the microphone.");
      return;
    }
    const browser = window as SpeechBrowser;
    const Recognition = browser.SpeechRecognition || browser.webkitSpeechRecognition;
    if (!Recognition) {
      setError("Voice dictation is unavailable in this browser. Type or paste the details below.");
      return;
    }
    try {
      const engine = new Recognition();
      engine.lang = language;
      engine.continuous = true;
      engine.interimResults = true;
      transcriptBaseRef.current = transcript.trim();
      engine.onresult = (event) => {
        const finalWords: string[] = [];
        const partialWords: string[] = [];
        for (let i = 0; i < event.results.length; i++) {
          const result = event.results[i];
          if (result.isFinal) finalWords.push(result[0].transcript);
          else partialWords.push(result[0].transcript);
        }
        setTranscript([transcriptBaseRef.current, ...finalWords, ...partialWords].filter(Boolean).join(" ").trim());
      };
      engine.onerror = (event) => {
        setError(`Microphone/speech recognition stopped (${event.error}). Your transcript can still be edited.`);
        setListening(false);
      };
      engine.onend = () => { setListening(false); engineRef.current = null; };
      engineRef.current = engine;
      setError(null);
      setSuccess(null);
      engine.start();
      setListening(true);
    } catch {
      engineRef.current = null;
      setListening(false);
      setError("Could not start microphone. Check browser permissions or use manual typing.");
    }
  }

  function chooseLead(id: string) {
    setLeadId(id);
    const lead = leads.find((l) => l.id === id);
    if (lead) {
      setShopName(lead.shopName);
      setContactName(lead.contactName ?? "");
      setPhone(lead.phone ?? "");
      setCity(lead.city ?? "");
      setLocality(lead.locality ?? "");
      setAddressLine(lead.addressLine ?? "");
    }
  }

  function extractSuggestions() {
    if (listening) stopMic();
    const parsed = parseOnboardingServices(transcript);
    const counts = suggestOnboardingCounts(transcript);
    setServices((old) => [...old, ...parsed.map((item) => ({ id: newId(), name: item.name, price: String(item.priceInr) }))].slice(0, 200));
    if (counts.chairCount !== undefined) setChairCount(String(counts.chairCount));
    if (counts.staffCount !== undefined) setStaffCount(String(counts.staffCount));
    setUnparsedNotice(parsed.length
      ? `${parsed.length} possible service/price entries added for manual verification. Remove incorrect or duplicate entries.`
      : "No numeric service prices were confidently detected. Add them manually; speech such as 'one hundred' may need correction.");
  }

  function captureLocation() {
    if (!navigator.geolocation) {
      setError("Location is unavailable. You can enter the shop address manually.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLatitude(Number(coords.latitude.toFixed(6)));
        setLongitude(Number(coords.longitude.toFixed(6)));
        setError(null);
      },
      () => setError("Location permission denied or timed out. Enter the address manually."),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 0 },
    );
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (listening) stopMic();
    setError(null);
    setSuccess(null);
    if (!consent) { setError("Salon owner's permission is required before saving their details."); return; }
    if (!shopName.trim() || !transcript.trim()) { setError("Shop name and transcript are required."); return; }
    const parsedServices = services.map((service) => ({
      name: service.name.trim(),
      priceInr: Number(service.price),
    }));
    if (services.some((s) => !s.name.trim() || !/^\d{1,7}$/.test(s.price) || Number(s.price) > 1000000)) {
      setError("Check every service name and INR price. Use whole numbers; do not guess missing prices.");
      return;
    }
    if ((chairCount && (!/^\d+$/.test(chairCount) || Number(chairCount) > 1000)) ||
        (staffCount && (!/^\d+$/.test(staffCount) || Number(staffCount) > 10000))) {
      setError("Chair/staff counts must be whole numbers within the permitted range.");
      return;
    }
    const body: CreateEmployeeVoiceLogInput = {
      clientRequestId: requestIdRef.current ?? newId(),
      leadId: leadId || null,
      shopName: shopName.trim(),
      consentConfirmed: true,
      transcript: transcript.trim(),
      language,
      contactName,
      phone,
      city,
      locality,
      addressLine,
      latitude,
      longitude,
      chairCount: chairCount ? Number(chairCount) : null,
      staffCount: staffCount ? Number(staffCount) : null,
      services: parsedServices,
      notes,
    };
    requestIdRef.current = body.clientRequestId;
    setSaving(true);
    try {
      const result = await apiFetch<EmployeeVoiceOnboardingLogDto>(API_PATH, {
        method: "POST",
        body: JSON.stringify(body),
      });
      requestIdRef.current = null;
      setSuccess(`Saved private onboarding log for ${result.shopName}. No public service prices changed.`);
      setTranscript("");
      setServices([]);
      setUnparsedNotice(null);
      await loadHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save. Your form remains here; retry when connected.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.shell}>
      <section className={styles.intro}>
        <p className={styles.eyebrow}>Field Executive · Voice Onboarding Assistant</p>
        <h2>Speak. Review. Save the shop visit.</h2>
        <p>Ask about haircut, beard, massage, rates, address, chairs and staff. Dictate in Hindi/Hinglish or English, correct the transcript, verify every price, then save a private CRM log.</p>
        <p className={styles.notice}>Speech recognition depends on your browser and may use its provider's cloud service. FastQue stores the text you explicitly save, not microphone audio. Do not record without the salon owner's permission.</p>
      </section>

      <form onSubmit={(e) => void save(e)}>
        <div className={styles.card}>
          <h3>1. Choose the shop</h3>
          <label>Existing CRM lead (optional)
            <select value={leadId} onChange={(e) => chooseLead(e.target.value)}>
              <option value="">Standalone shop visit</option>
              {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.shopName} · {lead.city ?? "City unknown"}</option>)}
            </select>
          </label>
          <div className={styles.grid}>
            <label>Shop name *<input required maxLength={180} value={shopName} onChange={(e) => setShopName(e.target.value)} /></label>
            <label>Owner / contact name<input maxLength={120} value={contactName} onChange={(e) => setContactName(e.target.value)} /></label>
            <label>Mobile number<input type="tel" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
            <label>City<input maxLength={120} value={city} onChange={(e) => setCity(e.target.value)} /></label>
            <label>Locality<input maxLength={160} value={locality} onChange={(e) => setLocality(e.target.value)} /></label>
            <label>Full address / landmark<input maxLength={300} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} /></label>
            <label>Chairs<input type="number" min={0} max={1000} step={1} value={chairCount} onChange={(e) => setChairCount(e.target.value)} /></label>
            <label>Staff / barbers<input type="number" min={0} max={10000} step={1} value={staffCount} onChange={(e) => setStaffCount(e.target.value)} /></label>
          </div>
          <div className={styles.row}>
            <button type="button" className={styles.secondary} onClick={captureLocation}>📍 Capture shop GPS (optional)</button>
            {latitude != null && longitude != null &&
              <span className={styles.small}>GPS: {latitude}, {longitude} <button type="button" onClick={() => { setLatitude(null); setLongitude(null); }}>Remove</button></span>}
          </div>
        </div>

        <div className={styles.card}>
          <h3>2. Dictate onboarding details</h3>
          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I have the salon owner's permission to capture and save these business/contact details.
          </label>
          <div className={styles.row}>
            <label>Dictation language
              <select value={language} disabled={listening} onChange={(e) => setLanguage(e.target.value as "hi-IN" | "en-IN")}>
                <option value="hi-IN">हिंदी / Hinglish</option>
                <option value="en-IN">English (India)</option>
              </select>
            </label>
            <button type="button" className={listening ? styles.stop : styles.primary}
              disabled={!consent && !listening} onClick={listening ? stopMic : startMic}>
              {listening ? "■ Stop microphone" : "🎙 Start speaking"}
            </button>
            {!recognitionAvailable && <span className={styles.small}>Microphone transcription unavailable in this browser. Use the text field below.</span>}
          </div>
          <p className={styles.hint}>Example: “Haircut 150 rupees, beard 80 rupees, head massage 200 rupees, chairs 4, staff 3.” Pause the microphone before editing the transcript.</p>
          <label>Transcript (editable, max 12,000 characters) *
            <textarea required rows={6} maxLength={12000} value={transcript}
              onChange={(e) => { setTranscript(e.target.value); requestIdRef.current = null; }} />
          </label>
          <button type="button" className={styles.secondary} onClick={extractSuggestions} disabled={!transcript.trim()}>
            Extract service and staff suggestions
          </button>
          {unparsedNotice && <p className={styles.notice}>{unparsedNotice}</p>}
        </div>

        <div className={styles.card}>
          <h3>3. Verify prices before saving</h3>
          <p className={styles.hint}>These are draft prices in INR. Verify with the shop owner. No price is published automatically.</p>
          {services.length === 0 && <p className={styles.small}>No structured service prices yet. Extract from transcript or add a row.</p>}
          {services.map((item) => (
            <div className={styles.serviceRow} key={item.id}>
              <label>Service<input maxLength={120} value={item.name} onChange={(e) => setServices((list) => list.map((x) => x.id === item.id ? { ...x, name: e.target.value } : x))} /></label>
              <label>Price ₹<input type="number" min={0} max={1000000} step={1} value={item.price}
                onChange={(e) => setServices((list) => list.map((x) => x.id === item.id ? { ...x, price: e.target.value } : x))} /></label>
              <button type="button" className={styles.remove} onClick={() => setServices((list) => list.filter((x) => x.id !== item.id))}>Remove</button>
            </div>
          ))}
          <button type="button" className={styles.secondary} disabled={services.length >= 200}
            onClick={() => setServices((list) => [...list, { id: newId(), name: "", price: "" }])}>+ Add service</button>
          <label>Other notes<textarea rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          <div className={styles.row}>
            <button className={styles.primary} disabled={saving || !consent || !shopName.trim() || !transcript.trim()}>
              {saving ? "Saving visit…" : "Save private shop log"}
            </button>
            <span className={styles.small}>Only your employee account can view these logs in this first version.</span>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {success && <p className={styles.success} role="status">{success}</p>}
        </div>
      </form>

      <section className={styles.card}>
        <div className={styles.historyHeader}><h3>Saved visit logs</h3>
          <button className={styles.secondary} type="button" onClick={() => void loadHistory()}>Refresh</button></div>
        {loading && <p className={styles.small}>Loading your logs…</p>}
        {!loading && history.length === 0 && <p className={styles.small}>No saved visits yet.</p>}
        {history.map((log) => <details className={styles.saved} key={log.id}>
          <summary><strong>{log.shopName}</strong> <span>{new Date(log.createdAt).toLocaleString("en-IN")}</span></summary>
          <p><strong>Contact:</strong> {log.contactName || "Not provided"} · {log.phone || "No phone"}</p>
          <p><strong>Address:</strong> {[log.addressLine, log.locality, log.city].filter(Boolean).join(", ") || "Not provided"}</p>
          <p><strong>Chairs:</strong> {log.chairCount ?? "Unknown"} · <strong>Staff:</strong> {log.staffCount ?? "Unknown"}</p>
          <ul>{log.services.map((s, i) => <li key={i}>{s.name}: ₹{s.priceInr}</li>)}</ul>
          <p className={styles.transcript}>{log.transcript}</p>
          <button type="button" className={styles.secondary} onClick={() => downloadText(log)}>Download private .txt log</button>
        </details>)}
        {history.length === 50 && <p className={styles.small}>Showing the 50 most recent logs. Contact your administrator if older records are needed.</p>}
      </section>
    </div>
  );
}
