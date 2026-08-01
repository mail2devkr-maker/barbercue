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

const DASHBOARD_QUEUE_PATH = (salonId: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queue}`;
const QUEUE_ENTRY_PATH = (id: string, action: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.queueEntries}/${id}/${action}`;
const SERVICE_SESSION_PATH = (id: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.serviceSessions}/${id}/${DASHBOARD_PATHS.complete}`;
const STAFF_STATUS_PATH = (id: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.staff}/${id}/${DASHBOARD_PATHS.status}`;

function statusColor(status: string): string {
  if (status === "WAITING") return "#B36B00";
  if (status === "CALLED") return "#B0413E";
  if (status === "IN_SERVICE") return "#2E7D32";
  return "#6B6357";
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
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
      <select value={staffId} onChange={(e) => setStaffId(e.target.value)} style={{ padding: "4px 8px" }}>
        <option value="">Staff…</option>
        {activeStaff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
      </select>
      <select value={chairId} onChange={(e) => setChairId(e.target.value)} style={{ padding: "4px 8px" }}>
        <option value="">Chair…</option>
        {chairs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void handleAssign()}
        disabled={submitting || !staffId || !chairId}
        style={{ padding: "4px 12px" }}
      >
        {submitting ? "Assigning…" : "Confirm assign"}
      </button>
      {error && <span style={{ color: "#E24B4A", fontSize: "0.85rem" }}>{error}</span>}
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

  if (loading) return <p style={{ color: "#6B6357" }}>Loading…</p>;
  if (error && !data) return <p style={{ color: "#E24B4A" }}>{error}</p>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {error && <p style={{ color: "#E24B4A" }}>{error}</p>}

      <section>
        <h2 style={{ fontSize: "1.1rem" }}>Staff on duty</h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {data.staffRoster.map((s) => (
            <div
              key={s.id}
              style={{
                border: "1px solid #E7E0D3",
                borderRadius: 8,
                padding: "8px 12px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span>{s.displayName}</span>
              <span style={{ color: statusColor(s.status), fontWeight: 600, fontSize: "0.85rem" }}>{s.status}</span>
              <button
                type="button"
                onClick={() => void handleToggleStaffStatus(s)}
                disabled={staffBusyId === s.id}
                style={{ padding: "2px 10px" }}
              >
                {s.status === StaffMemberStatus.ACTIVE ? "Clock out" : "Clock in"}
              </button>
            </div>
          ))}
          {data.staffRoster.length === 0 && <p style={{ color: "#6B6357" }}>No staff on the roster.</p>}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "1.1rem" }}>Live queue</h2>
        {data.entries.length === 0 && <p style={{ color: "#6B6357" }}>No one is currently waiting.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.entries.map((entry) => (
            <div key={entry.id} style={{ border: "1px solid #E7E0D3", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <strong>#{entry.tokenNumber}</strong>{" "}
                  {entry.customerPhone && <span style={{ color: "#6B6357" }}>{entry.customerPhone}</span>}
                  {entry.serviceName && <span style={{ color: "#6B6357" }}> — {entry.serviceName}</span>}
                </div>
                <span style={{ color: statusColor(entry.status), fontWeight: 600 }}>
                  {entry.status}
                  {entry.status === "WAITING" && entry.position ? ` (#${entry.position})` : ""}
                </span>
              </div>
              {entry.status === "WAITING" && entry.estimatedWaitMinutes !== null && (
                <p style={{ color: "#6B6357", margin: "6px 0 0", fontSize: "0.85rem" }}>
                  Est. wait: ~{entry.estimatedWaitMinutes} min
                </p>
              )}
              {entry.status === "IN_SERVICE" && (
                <p style={{ color: "#6B6357", margin: "6px 0 0", fontSize: "0.85rem" }}>
                  {entry.assignedStaffName} — {entry.assignedChairLabel}
                </p>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {entry.status === "WAITING" && (
                  <button
                    type="button"
                    onClick={() => void handleCall(entry.id)}
                    disabled={busyId === entry.id}
                    style={{ padding: "4px 12px" }}
                  >
                    Call
                  </button>
                )}
                {(entry.status === "WAITING" || entry.status === "CALLED") && (
                  <button
                    type="button"
                    onClick={() => setAssigningId(assigningId === entry.id ? null : entry.id)}
                    style={{ padding: "4px 12px" }}
                  >
                    Assign
                  </button>
                )}
                {entry.status === "CALLED" && (
                  <button
                    type="button"
                    onClick={() => void handleNoShow(entry.id)}
                    disabled={busyId === entry.id}
                    style={{ padding: "4px 12px" }}
                  >
                    No-show
                  </button>
                )}
                {entry.status === "IN_SERVICE" && entry.activeServiceSessionId && (
                  <button
                    type="button"
                    onClick={() => void handleComplete(entry.activeServiceSessionId!)}
                    disabled={busyId === entry.activeServiceSessionId}
                    style={{ padding: "4px 12px" }}
                  >
                    Complete
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleCancel(entry.id)}
                  disabled={busyId === entry.id}
                  style={{ padding: "4px 12px" }}
                >
                  Cancel
                </button>
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
