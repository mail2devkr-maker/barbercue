"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DASHBOARD_PATHS,
  StaffMemberStatus,
  type AssignQueueEntryInput,
  type ChairOptionDto,
  type DashboardQueueDto,
  type QueueEntryDetailDto,
  type StaffStatusDto,
} from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { newIdempotencyKey } from "../../lib/idempotency";
import { getRealtimeSocket, joinSalonRoom } from "../../lib/realtime";
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
  onAssigned,
}: {
  entry: QueueEntryDetailDto;
  staff: StaffStatusDto[];
  chairs: ChairOptionDto[];
  onAssigned: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [chairId, setChairId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeStaff = staff.filter((s) => s.status === StaffMemberStatus.ACTIVE);

  async function handleAssign() {
    if (!staffId || !chairId) return;
    setSubmitting(true);
    setError(null);
    try {
      const input: AssignQueueEntryInput = { staffId, chairId };
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
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} className={styles.assignSelect}>
        <option value="">Staff…</option>
        {activeStaff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </select>
      <select value={chairId} onChange={(e) => setChairId(e.target.value)} className={styles.assignSelect}>
        <option value="">Chair…</option>
        {chairs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <Button type="button" variant="outline" onClick={() => void handleAssign()} disabled={submitting || !staffId || !chairId}>
        {submitting ? "Assigning…" : "Confirm assign"}
      </Button>
      {error && <span className={styles.errorText}>{error}</span>}
    </div>
  );
}

export function DashboardQueueView({ salonId }: { salonId: string }) {
  const [data, setData] = useState<DashboardQueueDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);

  const refetch = useCallback(() => {
    return apiFetch<DashboardQueueDto>(DASHBOARD_QUEUE_PATH(salonId))
      .then((result) => setData(result))
      .catch(() => {
        /* transient — the next realtime event or manual refresh will retry */
      });
  }, [salonId]);

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
        setData(result);
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
  }, [salonId]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onEvent(payload: { salonId: string }) {
      if (payload.salonId === salonId) void refetch();
    }
    socket.on("queue.updated", onEvent);
    socket.on("queue.entry.called", onEvent);
    socket.on("staff.status.changed", onEvent);
    return () => {
      socket.off("queue.updated", onEvent);
      socket.off("queue.entry.called", onEvent);
      socket.off("staff.status.changed", onEvent);
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

  if (loading) return <p className={styles.stepLoading}>Loading…</p>;
  if (error && !data) return <p className={styles.errorText}>{error}</p>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {error && <p className={styles.errorText}>{error}</p>}

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
            <div key={entry.id} className={styles.entryCard}>
              <div className={styles.entryHead}>
                <div>
                  <span className={styles.entryToken}>#{entry.tokenNumber}</span>{" "}
                  {entry.customerPhone && <span className={styles.entryMeta}>{entry.customerPhone}</span>}
                  {entry.serviceName && <span className={styles.entryMeta}> — {entry.serviceName}</span>}
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
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => void handleComplete(entry.activeServiceSessionId!)}
                    disabled={busyId === entry.activeServiceSessionId}
                  >
                    Complete
                  </Button>
                )}
                <Button type="button" variant="outline" onClick={() => void handleCancel(entry.id)} disabled={busyId === entry.id}>
                  Cancel
                </Button>
              </div>

              {assigningId === entry.id && (
                <AssignForm
                  entry={entry}
                  staff={data.staffRoster}
                  chairs={data.chairs}
                  onAssigned={() => {
                    setAssigningId(null);
                    void refetch();
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
