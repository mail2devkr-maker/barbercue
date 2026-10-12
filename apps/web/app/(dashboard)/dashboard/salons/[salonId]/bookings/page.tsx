import { OwnerBookingsView } from "../../../../../../components/bookings/OwnerBookingsView";
import { ArrivalAlertOverlay } from "../../../../../../components/bookings/ArrivalAlertOverlay";
import { BtnLink, PageHead } from "../../../../../../components/owner/parts";

// Owner-only salon bookings dashboard: today/upcoming/completed/cancelled/no-show/history, with
// realtime "new booking"/"booking cancelled" alerts over the same /realtime socket the Live Queue
// uses. Appointments (online and in-shop) live here; people standing in the shop who want the next
// free barber are added to the Live Queue instead.
export default async function DashboardBookingsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main aria-label="Bookings">
      <PageHead
        title="Bookings"
        sub="Online and in-shop appointments, today's schedule and booking history for your shop."
        actions={
          <>
            <BtnLink variant="primary" icon="plus" href={`/dashboard/salons/${salonId}/bookings/new`}>
              New in-shop appointment
            </BtnLink>
            <BtnLink icon="calendarGrid" href={`/dashboard/salons/${salonId}/schedule`}>
              Calendar
            </BtnLink>
          </>
        }
      />
      <OwnerBookingsView salonId={salonId} />
      <ArrivalAlertOverlay salonId={salonId} />
    </main>
  );
}
