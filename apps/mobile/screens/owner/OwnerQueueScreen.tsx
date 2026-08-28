import { useSalon } from '../../lib/salon-context';
import { Screen, SectionHeader, EmptyState } from '../../components/ui';
import { LiveQueuePanel } from '../../components/dashboard/LiveQueuePanel';

export default function OwnerQueueScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Select a shop" message="Choose a shop from the Dashboard tab to see its live queue." />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader eyebrow="Live queue" title={selectedSalon?.name ?? 'Queue'} />
      <LiveQueuePanel salonId={selectedSalonId} />
    </Screen>
  );
}
