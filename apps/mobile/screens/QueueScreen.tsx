import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { QUEUE_ENTRIES_PATH, type QueueEntryDetailDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { Screen, SectionHeader, EmptyState, Skeleton, ErrorState } from '../components/ui';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import { useLanguage } from '../lib/language-context';
import type { TabParamList } from '../navigation/types';

const ACTIVE_QUEUE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

export default function QueueScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<TabParamList>>();
  const { t } = useLanguage();
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    setError(null);
    try {
      const active = await apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`);
      setEntry(active && ACTIVE_QUEUE_STATUSES.has(active.status) ? active : null);
    } catch {
      setError(t.couldNotLoadQueueStatus);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  return (
    <Screen refreshing={refreshing} onRefresh={() => void load(true)}>
      <SectionHeader eyebrow={t.liveQueue} title={t.queueStatusTitle} />

      {loading ? (
        <Skeleton style={{ height: 140, borderRadius: 20 }} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load(false)} />
      ) : entry ? (
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      ) : (
        <EmptyState
          title={t.noActiveQueueTitle}
          message={t.noActiveQueueHint}
          actionLabel={t.findASalonAction}
          onAction={() => navigation.navigate('SearchTab', { screen: 'SalonSearch' })}
        />
      )}
    </Screen>
  );
}
