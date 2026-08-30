"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DASHBOARD_PATHS,
  SPEECH_LOCALE,
  StaffMemberStatus,
  voiceAnnouncementsFor,
  type AssignQueueEntryInput,
  type ChairOptionDto,
  type DashboardQueueDto,
  type QueueEntryDetailDto,
  type ReassignQueueEntryInput,
  type ServiceOptionDto,
  type StaffStatusDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { getRealtimeSocket, joinSalonRoom, onReconnect } from "../../lib/realtime";
import { useAuth } from "../../lib/auth-context";
import { Button } from "../ui/Button";
import styles from "./queue.module.css";

const DASHBOARD_QUEUE_PATH = (salonId: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queue}`;
const QUEUE_ENTRY_PATH = (id: string, action: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.queueEntries}/${id}/${action}`;
const SERVICE_SESSION_PATH = (id: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.serviceSessions}/${id}/${DASHBOARD_PATHS.complete}`;
const STAFF_STATUS_PATH = (id: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.staff}/${id}/${DASHBOARD_PATHS.status}`;

function statusBadgeClass(status: string): string {
  if (status === "CALLED") return styles.statusCalled;
  if (status === "IN_SERVICE") return styles.statusInService;
  if (status === "WAITING") return styles.statusWaiting;
  return styles.statusNeutral;
}

function AssignForm({
  entry,
  staff,
  chairs,
  services,
  onAssigned,
}: {
  entry: QueueEntryDetailDto;
  staff: StaffStatusDto[];
  chairs: ChairOptionDto[];
  services: ServiceOptionDto[];
  onAssigned: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [chairId, setChairId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStaff = staff.filter((s) => s.status === StaffMemberStatus.ACTIVE);
  // A walk-in that picked a service when joining already has one on the entry — QueueService.
  // assign() only needs one supplied when it doesn't, and re-asking here would just be confusing
  // ("didn't I already say Haircut?").
  const needsService = !entry.serviceId;

  async function handleAssign() {
    if (!staffId || !chairId || (needsService && !serviceId)) return;
    setSubmitting(true);
    setError(null);
    try {
      const input: AssignQueueEntryInput = { staffId, chairId, ...(needsService ? { serviceId } : {}) };
      await apiFetch(QUEUE_ENTRY_PATH(entry.id, DASHBOARD_PATHS.assign), {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey() },
        body: JSON.stringify(input),
      });
      onAssigned();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not assign this customer.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.assignRow}>
      {needsService && (
        <label className={styles.assignField}>
          <span>Service</span>
          <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={styles.assignSelect}>
            <option value="">Service…</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={styles.assignField}>
        <span>Barber</span>
        <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={styles.assignSelect}>
        <option value="">Staff…</option>
        {activeStaff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
        </select>
      </label>
      <label className={styles.assignField}>
        <span>Chair</span>
        <select value={chairId} onChange={(e) => setChairId(e.target.value)} className={styles.assignSelect}>
        <option value="">Chair…</option>
        {chairs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
        </select>
      </label>
      <Button
        type="button"
        variant="outline"
        onClick={() => void handleAssign()}
        disabled={submitting || !staffId || !chairId || (needsService && !serviceId)}
      >
        {submitting ? "Assigning…" : "Confirm assign"}
      </Button>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}

function ReassignForm({
  entry,
  staff,
  chairs,
  onAssigned,
}: {
  entry: QueueEntryDetailDto;
  staff: StaffStatusDto[];
  chairs: ChairOptionDto[];
  onAssigned: () => void;
}) {
  const [staffId, setStaffId] = useState(entry.assignedStaffId ?? "");
  const [chairId, setChairId] = useState(entry.assignedChairId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStaff = staff.filter((member) => member.status === StaffMemberStatus.ACTIVE);
  const changed = staffId !== entry.assignedStaffId || chairId !== entry.assignedChairId;

  async function handleReassign() {
    if (!staffId || !chairId || !changed) return;
    setSubmitting(true);
    setError(null);
    const input: ReassignQueueEntryInput = {};
    if (staffId !== entry.assignedStaffId) input.staffId = staffId;
    if (chairId !== entry.assignedChairId) input.chairId = chairId;
    try {
      await apiFetch(QUEUE_ENTRY_PATH(entry.id, DASHBOARD_PATHS.reassign), {
        method: "PATCH",
        body: JSON.stringify(input),
      });
      onAssigned();
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : "Could not reassign this visit.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.assignRow}>
      <label className={styles.assignField}>
        <span>Move to barber</span>
        <select value={staffId} onChange={(event) => setStaffId(event.target.value)} className={styles.assignSelect}>
          {activeStaff.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
        </select>
      </label>
      <label className={styles.assignField}>
        <span>Move to chair</span>
        <select value={chairId} onChange={(event) => setChairId(event.target.value)} className={styles.assignSelect}>
          {chairs.map((chair) => <option key={chair.id} value={chair.id}>{chair.label}</option>)}
        </select>
      </label>
      <Button type="button" variant="outline" onClick={() => void handleReassign()} disabled={submitting || !staffId || !chairId || !changed}>
        {submitting ? "Reassigning…" : "Confirm reassignment"}
      </Button>
      {error && <span className={styles.errorText} role="alert">{error}</span>}
    </div>
  );
}

export function DashboardQueueView({ salonId }: { salonId: string }) {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardQueueDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);
  const [newEntryIds, setNewEntryIds] = useState<string[]>([]);
  const [newEntryNotice, setNewEntryNotice] = useState<QueueEntryDetailDto | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const initializedRef = useRef(false);
  const knownWaitingIdsRef = useRef<Set<string>>(new Set());
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const audioContextRef = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const voiceEnabledRef = useRef(false);
  // Set language (see profile page) rather than the queue itself — this bell rings for whichever
  // owner/staff member is watching this dashboard right now.
  const preferredLanguageRef = useRef(user?.preferredLanguage);
  useEffect(() => {
    preferredLanguageRef.current = user?.preferredLanguage;
  }, [user?.preferredLanguage]);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    if (preferredLanguageRef.current) utterance.lang = SPEECH_LOCALE[preferredLanguageRef.current];
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, []);

  const playChime = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || context.state !== "running") return;
    const now = context.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = frequency;
      oscillator.type = "sine";
      gain.gain.setValueAtTime(0.0001, now + index * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.14, now + index * 0.13 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.13 + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + index * 0.13);
      oscillator.stop(now + index * 0.13 + 0.14);
    });
  }, []);

  const applyQueueResult = useCallback((result: DashboardQueueDto, detectNew: boolean) => {
    const waiting = result.entries.filter((entry) => entry.status === "WAITING");
    const waitingIds = new Set(waiting.map((entry) => entry.id));
    if (detectNew && initializedRef.current) {
      const genuinelyNew = waiting.filter((entry) =>
        !knownWaitingIdsRef.current.has(entry.id) && !notifiedIdsRef.current.has(entry.id),
      );
      if (genuinelyNew.length > 0) {
        genuinelyNew.forEach((entry) => notifiedIdsRef.current.add(entry.id));
        setNewEntryIds((current) => Array.from(new Set([...current, ...genuinelyNew.map((entry) => entry.id)])));
        const latest = genuinelyNew[genuinelyNew.length - 1];
        setNewEntryNotice(latest);
        if (soundEnabledRef.current) playChime();
        if (voiceEnabledRef.current) {
          const announcements = voiceAnnouncementsFor(preferredLanguageRef.current);
          speak(announcements.newCustomerJoined(latest.tokenNumber, latest.serviceName));
        }
      }
    }
    knownWaitingIdsRef.current = waitingIds;
    initializedRef.current = true;
    setData(result);
  }, [playChime, speak]);

  const refetch = useCallback(() => {
    return apiFetch<DashboardQueueDto>(DASHBOARD_QUEUE_PATH(salonId))
      .then((result) => applyQueueResult(result, true))
      .catch(() => {
        /* transient — the next realtime event or manual refresh will retry */
      });
  }, [applyQueueResult, salonId]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (cancelled) return undefined;
        setLoading(true);
        setError(null);
        return apiFetch<DashboardQueueDto>(DASHBOARD_QUEUE_PATH(salonId));
      })
      .then((result) => {
        if (cancelled || !result) return;
        applyQueueResult(result, false);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Could not load the queue.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [applyQueueResult, salonId]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onEvent(payload: { salonId: string }) {
      if (payload.salonId === salonId) void refetch();
    }
    socket.on("queue.updated", onEvent);
    socket.on("queue.entry.called", onEvent);
    socket.on("staff.status.changed", onEvent);
    socket.on("queue.entry.reassigned", onEvent);
    // Phase 15: a dropped/restored connection may have missed events entirely — resync once the
    // socket is reconnected, rather than waiting for the next queue change to happen to notice.
    const unsubscribeReconnect = onReconnect(() => void refetch());
    return () => {
      socket.off("queue.updated", onEvent);
      socket.off("queue.entry.called", onEvent);
      socket.off("staff.status.changed", onEvent);
      socket.off("queue.entry.reassigned", onEvent);
      unsubscribeReconnect();
    };
  }, [salonId, refetch]);

  async function handleCall(entryId: string) {
    setBusyId(entryId);
    try {
      await apiFetch(QUEUE_ENTRY_PATH(entryId, DASHBOARD_PATHS.call), { method: "POST" });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not call this customer.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleNoShow(entryId: string) {
    setBusyId(entryId);
    try {
      await apiFetch(QUEUE_ENTRY_PATH(entryId, DASHBOARD_PATHS.noShow), { method: "POST" });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this customer as a no-show.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel(entryId: string) {
    setBusyId(entryId);
    try {
      await apiFetch(QUEUE_ENTRY_PATH(entryId, DASHBOARD_PATHS.cancel), { method: "POST" });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel this entry.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleComplete(sessionId: string) {
    setBusyId(sessionId);
    try {
      await apiFetch(SERVICE_SESSION_PATH(sessionId), { method: "POST" });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not complete this service.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleStaffStatus(staff: StaffStatusDto) {
    setStaffBusyId(staff.id);
    try {
      const nextStatus =
        staff.status === StaffMemberStatus.ACTIVE ? StaffMemberStatus.INACTIVE : StaffMemberStatus.ACTIVE;
      await apiFetch(STAFF_STATUS_PATH(staff.id), {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      await refetch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update staff status.");
    } finally {
      setStaffBusyId(null);
    }
  }

  async function enableSound() {
    const AudioContextClass = window.AudioContext;
    const context = audioContextRef.current ?? new AudioContextClass();
    audioContextRef.current = context;
    if (context.state === "suspended") await context.resume();
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    playChime();
  }

  function enableVoice() {
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    speak(voiceAnnouncementsFor(preferredLanguageRef.current).voiceAnnouncementsOn());
  }

  if (loading) return <p className={styles.stepLoading}>Loading…</p>;
  if (error && !data) return <p className={styles.errorText}>{error}</p>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <p className={styles.errorText}>{error}</p>}
      <div className={styles.queueTools}>
        <p>Realtime updates are on.</p>
        <Button type="button" variant="outline" onClick={() => void enableSound()} disabled={soundEnabled}>
          {soundEnabled ? "Queue chime enabled" : "Enable queue chime"}
        </Button>
        <Button type="button" variant="outline" onClick={enableVoice} disabled={voiceEnabled}>
          {voiceEnabled ? "Voice announcements enabled" : "Enable voice announcements"}
        </Button>
      </div>

      <div className={styles.liveAnnouncer} aria-live="polite" aria-atomic="true">
        {newEntryNotice && (
          <div className={styles.newEntryBanner}>
            <div>
              <strong>New customer joined</strong>
              <span>
                Token #{newEntryNotice.tokenNumber}
                {newEntryNotice.serviceName ? ` · ${newEntryNotice.serviceName}` : ""}
                {newEntryNotice.customerPhone ? ` · ${newEntryNotice.customerPhone}` : ""}
              </span>
            </div>
            <Button type="button" variant="outline" onClick={() => setNewEntryNotice(null)}>Dismiss</Button>
          </div>
        )}
      </div>

      <section className={styles.dashSection}>
        <h2 className={styles.dashHeading}>Staff on duty</h2>
        <div className={styles.staffRow}>
          {data.staffRoster.map((s) => (
            <div key={s.id} className={styles.staffChip}>
              <span className={styles.staffChipName}>{s.displayName}</span>
              <span
                className={styles.staffChipStatus}
                style={{ color: s.status === StaffMemberStatus.ACTIVE ? "var(--bc-success)" : "var(--bc-muted)" }}
              >
                {s.status}
              </span>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleToggleStaffStatus(s)}
                disabled={staffBusyId === s.id}
              >
                {s.status === StaffMemberStatus.ACTIVE ? "Clock out" : "Clock in"}
              </Button>
            </div>
          ))}
          {data.staffRoster.length === 0 && <p className={styles.emptyState}>No staff on the roster.</p>}
        </div>
      </section>

      <section className={styles.dashSection}>
        <h2 className={styles.dashHeading}>Live queue</h2>
        {data.entries.length === 0 && <p className={styles.emptyState}>No one is currently waiting.</p>}
        <div className={styles.entryList}>
          {data.entries.map((entry) => (
            <div key={entry.id} className={`${styles.entryCard} ${newEntryIds.includes(entry.id) ? styles.entryCardNew : ""}`}>
              <div className={styles.entryHead}>
                <div>
                  <span className={styles.entryToken}>#{entry.tokenNumber}</span>{" "}
                  {entry.customerPhone && <span className={styles.entryMeta}>{entry.customerPhone}</span>}
                  {entry.serviceName && <span className={styles.entryMeta}> — {entry.serviceName}</span>}
                  {newEntryIds.includes(entry.id) && <span className={styles.newBadge}>NEW</span>}
                </div>
                <span className={`${styles.ticketStatusBadge} ${statusBadgeClass(entry.status)}`}>
                  {entry.status}
                  {entry.status === "WAITING" && entry.position ? ` (#${entry.position})` : ""}
                </span>
              </div>
              {entry.status === "WAITING" && entry.estimatedWaitMinutes !== null && (
                <p className={styles.entryDetail}>Est. wait: ~{entry.estimatedWaitMinutes} min</p>
              )}
              {entry.status === "IN_SERVICE" && (
                <p className={styles.entryDetail}>
                  {entry.assignedStaffName} — {entry.assignedChairLabel}
                </p>
              )}

              <div className={styles.entryActions}>
                {entry.status === "WAITING" && (
                  <Button type="button" variant="primary" onClick={() => void handleCall(entry.id)} disabled={busyId === entry.id}>
                    Call
                  </Button>
                )}
                {(entry.status === "WAITING" || entry.status === "CALLED") && (
                  <Button type="button" variant="outline" onClick={() => setAssigningId(assigningId === entry.id ? null : entry.id)}>
                    Assign
                  </Button>
                )}
                {entry.status === "CALLED" && (
                  <Button type="button" variant="outline" onClick={() => void handleNoShow(entry.id)} disabled={busyId === entry.id}>
                    No-show
                  </Button>
                )}
                {entry.status === "IN_SERVICE" && entry.activeServiceSessionId && (
                  <>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => void handleComplete(entry.activeServiceSessionId!)}
                      disabled={busyId === entry.activeServiceSessionId}
                    >
                      Complete
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setAssigningId(assigningId === entry.id ? null : entry.id)}>
                      Reassign barber/chair
                    </Button>
                  </>
                )}
                <Button type="button" variant="outline" onClick={() => void handleCancel(entry.id)} disabled={busyId === entry.id}>
                  Cancel
                </Button>
              </div>

              {assigningId === entry.id && (
                entry.status === "IN_SERVICE" ? (
                  <ReassignForm entry={entry} staff={data.staffRoster} chairs={data.chairs} onAssigned={() => {
                    setAssigningId(null);
                    void refetch();
                  }} />
                ) : (
                  <AssignForm entry={entry} staff={data.staffRoster} chairs={data.chairs} services={data.services} onAssigned={() => {
                    setAssigningId(null);
                    void refetch();
                  }} />
                )
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
