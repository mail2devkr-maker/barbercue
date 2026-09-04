import { useRef, useState } from 'react';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { Screen, SectionHeader, EmptyState } from '../../components/ui';
import { LiveQueuePanel, type LiveQueuePanelHandle } from '../../components/dashboard/LiveQueuePanel';

export default function OwnerQueueScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const panelRef = useRef<LiveQueuePanelHandle>(null);
  const [refreshing, setRefreshing] = useState(false);

  if (!selectedSalonId) {
    return (
      <Screen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopQueueHint} />
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
      <SectionHeader eyebrow={t.liveQueue} title={selectedSalon?.name ?? t.queueTitle} />
      <LiveQueuePanel ref={panelRef} salonId={selectedSalonId} />
    </Screen>
  );
}
