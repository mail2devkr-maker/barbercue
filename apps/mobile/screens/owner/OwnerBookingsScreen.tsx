import { Screen, SectionHeader, EmptyState } from '../../components/ui';

// Honest gap, not a stub pretending to load: bookings.controller.ts is @Roles(Role.CUSTOMER)
// only — there is currently no backend endpoint for an owner/staff to list or manage their
// salon's bookings (confirmed by reading the controller directly, not assumed). Today's
// checked-in/queue-linked activity is visible on the Queue tab; a full bookings-management view
// needs a new dashboard-scoped endpoint before this tab can show real data.
export default function OwnerBookingsScreen() {
  return (
    <Screen scroll={false}>
      <SectionHeader eyebrow="Owner" title="Bookings" />
      <EmptyState
        title="Not available yet"
        message="Shop-wide booking management isn't exposed by the API yet. Checked-in customers already show up on the Queue tab."
      />
    </Screen>
  );
}
