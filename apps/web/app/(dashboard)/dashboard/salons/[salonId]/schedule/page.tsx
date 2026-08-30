import Link from "next/link";
import { DayScheduler } from "../../../../../../components/dashboard/DayScheduler";
import styles from "../../../../../../components/dashboard/dashboard.module.css";
import scheduleStyles from "../../../../../../components/dashboard/schedule.module.css";

// Owner-only day scheduler: real bookings positioned by their actual slotStart/slotEnd, columned
// by staff. Deliberately a Day view only, not Week — a truthful week grid would need aggregating
// 7 separate day-ranges per staff member with no incremental win over just paging the day forward,
// and the existing list view (OwnerBookingsView) already covers "everything, filterable" without
// needing a second, redundant week UI. Staff columns key off assignedStaffId first (set only once
// a booking is actually checked in) and fall back to preferredStaffId (the customer's soft
// preference at booking time) — never presenting a preference as a confirmed assignment, since the
// salon assigns the real barber/chair at check-in, same rule the booking flow itself states.
export default async function DaySchedulePage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>Schedule</h1>
      <p className={styles.pageSubtitle}>
        Your shop&apos;s day, laid out by time and barber. Columns reflect a customer&apos;s
        barber preference until check-in actually assigns one.
      </p>
      <nav className={scheduleStyles.viewToggle}>
        <Link href={`/dashboard/salons/${salonId}/bookings`}>List view</Link>
        <Link href={`/dashboard/salons/${salonId}/schedule`} className={scheduleStyles.viewToggleActive}>
          Day schedule
        </Link>
      </nav>
      <DayScheduler salonId={salonId} />
    </main>
  );
}
