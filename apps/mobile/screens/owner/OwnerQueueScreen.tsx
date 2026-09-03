import { useRef, useState } from 'react';
import { useSalon } from '../../lib/salon-context';
import { Screen, SectionHeader, EmptyState } from '../../components/ui';
import { LiveQueuePanel, type LiveQueuePanelHandle } from '../../components/dashboard/LiveQueuePanel';

export default function OwnerQueueScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const panelRef = useRef<LiveQueuePanelHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Select a shop" message="Choose a shop from the Dashboard tab to see its live queue." />
      </Screen>
    );
  }

  async function handleRefresh() {
    setRefreshing(true);
    await panelRef.current?.refresh();
    setRefreshing(false);
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void handleRefresh()}>
      <SectionHeader eyebrow="Live queue" title={selectedSalon?.name ?? 'Queue'} />
      <LiveQueuePanel ref={panelRef} salonId={selectedSalonId} />
    </Screen>
  );
}
