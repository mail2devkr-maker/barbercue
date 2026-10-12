import { ArrivalAlertOverlay } from "../../../../../../components/bookings/ArrivalAlertOverlay";
import { LiveQueueConsole } from "../../../../../../components/owner/LiveQueueConsole";

// The operational floor: separate Waiting / In service / Completed / History views, one-tap
// automatic seating, realtime updates with a polling fallback. (It no longer carries the shop-setup
// wizard's "Finish setup" step or the seat-a-local-customer chair buttons: adding someone who is in
// the shop is the explicit "New Live Queue customer" action, which gives them a real queue entry.)
export default async function DashboardQueuePage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = await params;
  return (
    <main aria-label="Live Queue">
      <LiveQueueConsole salonId={salonId} />
      <ArrivalAlertOverlay salonId={salonId} />
    </main>
  );
}
