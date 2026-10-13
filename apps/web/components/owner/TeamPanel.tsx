"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerOverviewDto, SalonStaffDto, StaffWorkingHoursDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { formatMoney } from "./format";
import { Badge, Banner, BtnLink, Card, EmptyState, PageHead, Skeleton, Tabs } from "./parts";
import ui from "./owner.module.css";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Tab = "performance" | "schedule";

/** Staff performance (from completed services) and staff schedule (each barber's weekly hours). */
export function TeamPanel({ salonId }: { salonId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = params.get("tab") === "schedule" ? "schedule" : "performance";
  const setTab = (next: Tab) => router.replace(`${pathname}?tab=${next}`, { scroll: false });
  return (
    <>
      <PageHead
        eyebrow="Team"
        title={tab === "schedule" ? "Staff schedule" : "Staff performance"}
        sub={tab === "schedule" ? "Each barber's weekly working hours. A barber with no hours set works whenever the shop is open." : "Completed services per barber. Ratings belong to a booking, not to a barber, so FastQue does not show a per-barber rating."}
        actions={
          <>
            <Tabs label="Team sections" value={tab} onChange={setTab} tabs={[{ id: "performance", label: "Performance" }, { id: "schedule", label: "Schedule" }]} />
            <BtnLink icon="team" href={`/dashboard/salons/${salonId}/staff`}>Manage staff</BtnLink>
          </>
        }
      />
      {tab === "performance" ? <Performance salonId={salonId} /> : <Schedule salonId={salonId} />}
    </>
  );
}

function Performance({ salonId }: { salonId: string }) {
  const [data, setData] = useState<OwnerOverviewDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiFetch<OwnerOverviewDto>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/overview`).then(setData).catch((err) => setError(err instanceof ApiError ? err.message : "Could not load staff performance."));
  }, [salonId]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!data) return <Skeleton height={160} />;
  return (
    <Card>
      {data.staffPerformance.length === 0 ? (
        <EmptyState title="No barbers yet" />
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <thead><tr><th>Barber</th><th>Right now</th><th className={ui.num}>Done today</th><th className={ui.num}>Done in 30 days</th><th className={ui.num}>Estimated value (30 days)</th></tr></thead>
            <tbody>
              {data.staffPerformance.map((s) => (
                <tr key={s.staffId}>
                  <td><strong>{s.displayName}</strong></td>
                  <td>
                    <Badge tone={s.availabilityState === "AVAILABLE" ? "ok" : s.availabilityState === "OFF_DUTY" ? "neutral" : "warn"}>
                      {s.availabilityState === "AVAILABLE" ? "Available" : s.availabilityState === "IN_SERVICE" ? "With a customer" : s.availabilityState === "RESERVED" ? "Booked soon" : "Off duty"}
                    </Badge>
                  </td>
                  <td className={ui.num}>{s.completedToday}</td>
                  <td className={ui.num}>{s.completedLast30Days}</td>
                  <td className={ui.num}>{formatMoney(s.estimatedValueLast30Days, data.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={ui.cardSub} style={{ marginTop: 10 }}>Estimated value uses each service&apos;s listed price; it is not recorded revenue.</p>
    </Card>
  );
}

function Schedule({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}`;
  const [rows, setRows] = useState<{ staff: SalonStaffDto; hours: StaffWorkingHoursDto[] }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<SalonStaffDto[]>(base)
      .then(async (staff) => {
        const hours = await Promise.all(staff.map((s) => apiFetch<StaffWorkingHoursDto[]>(`${base}/${s.id}/${DASHBOARD_PATHS.workingHours}`).catch(() => [])));
        if (!cancelled) setRows(staff.map((s, i) => ({ staff: s, hours: hours[i] })));
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load schedules."));
    return () => {
      cancelled = true;
    };
  }, [base]);
  if (error) return <Banner tone="error">{error}</Banner>;
  if (!rows) return <Skeleton height={160} />;
  if (rows.length === 0) return <Card><EmptyState title="No barbers yet" action={<BtnLink small href={`/dashboard/salons/${salonId}/staff`} icon="plus">Add a barber</BtnLink>} /></Card>;
  return (
    <Card>
      <div className={ui.tableWrap}>
        <table className={ui.table}>
          <thead><tr><th>Barber</th>{DAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>
            {rows.map(({ staff, hours }) => (
              <tr key={staff.id}>
                <td>
                  <strong>{staff.displayName}</strong>
                  <div className={ui.cardSub}>{staff.status === "ACTIVE" ? "On duty" : "Off duty"}</div>
                </td>
                {DAYS.map((_, dow) => {
                  const h = hours.find((x) => x.dayOfWeek === dow);
                  return (
                    <td key={dow} className={h?.configured ? "" : ui.mutedCell}>
                      {!h || !h.configured ? "Shop hours" : h.isClosed ? "Off" : `${h.openTime}–${h.closeTime}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={ui.cardSub} style={{ marginTop: 10 }}>To change a barber&apos;s hours, open Manage staff and choose their hours.</p>
    </Card>
  );
}
