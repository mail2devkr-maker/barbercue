import { useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { Screen, SectionHeader, EmptyState } from '../../components/ui';
import { LiveQueuePanel, type LiveQueuePanelHandle } from '../../components/dashboard/LiveQueuePanel';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

export default function OwnerQueueScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const navigation = useNavigation<BottomTabNavigationProp<OwnerTabParamList>>();
  const route = useRoute<RouteProp<OwnerTabParamList, 'OwnerQueueTab'>>();
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
      <LiveQueuePanel
        ref={panelRef}
        salonId={selectedSalonId}
        role="owner"
        autoOpenNewCustomer={route.params?.newCustomer === true}
        onNewAppointment={() => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerInShopAppointment' })}
        onOpenInvoice={(invoiceId) => navigation.navigate('OwnerShopTab', { initial: false, screen: 'OwnerInvoiceDetail', params: { invoiceId } })}
      />
    </Screen>
  );
}
