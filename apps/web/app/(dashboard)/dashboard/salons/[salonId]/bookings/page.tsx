import Link from "next/link";
import { OwnerBookingsView } from "../../../../../../components/bookings/OwnerBookingsView";
import styles from "../../../../../../components/dashboard/dashboard.module.css";
import scheduleStyles from "../../../../../../components/dashboard/schedule.module.css";

// Owner-only salon bookings dashboard: today/upcoming/completed/cancelled/no-show/history, with
// realtime "new booking"/"booking cancelled" alerts over the same /realtime socket the live queue
// page already uses. Not part of the guided setup wizard (SetupNavigation) — it's an ongoing
// operational view, reachable from the settings hub nav like Live queue is.
export default async function DashboardBookingsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main className={styles.pageWide}>
      <h1 className={styles.pageTitle}>Bookings</h1>
      <p className={styles.pageSubtitle}>
        Incoming appointments, today&apos;s schedule, and booking history for your shop.
      </p>
      <nav className={scheduleStyles.viewToggle}>
        <Link href={`/dashboard/salons/${salonId}/bookings`} className={scheduleStyles.viewToggleActive}>
          List view
        </Link>
        <Link href={`/dashboard/salons/${salonId}/schedule`}>Day schedule</Link>
      </nav>
      <OwnerBookingsView salonId={salonId} />
    </main>
  );
}
