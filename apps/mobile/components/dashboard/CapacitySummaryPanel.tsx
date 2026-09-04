import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, type CapacitySummaryDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';

function capacityPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.capacity}`;
}

/**
 * Owner Capacity Dashboard (Phase 6) — compact, decision-oriented operational snapshot on the
 * Owner Dashboard tab. Same non-critical/fail-quiet behaviour as the web CapacitySummaryPanel —
 * this is a convenience widget, not something that should ever block the rest of the tab.
 */
export function CapacitySummaryPanel({ salonId }: { salonId: string }) {
  const { t } = useLanguage();
  const [data, setData] = useState<CapacitySummaryDto | null>(null);

  const load = useCallback(() => {
    apiFetch<CapacitySummaryDto>(capacityPath(salonId))
      .then(setData)
      .catch(() => {
        /* non-critical widget — silently keep the last known value (or none) */
      });
  }, [salonId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onEvent(payload: { salonId: string }) {
      if (payload.salonId === salonId) load();
    }
    socket.on('queue.updated', onEvent);
    socket.on('staff.status.changed', onEvent);
    socket.on('booking.created', onEvent);
    socket.on('booking.cancelled', onEvent);
    const unsubscribeReconnect = onReconnect(load); // Phase 15: resync after a dropped connection
    return () => {
      socket.off('queue.updated', onEvent);
      socket.off('staff.status.changed', onEvent);
      socket.off('booking.created', onEvent);
      socket.off('booking.cancelled', onEvent);
      unsubscribeReconnect();
    };
  }, [salonId, load]);

  if (!data) return null;

  return (
    <View style={styles.row}>
      <View style={styles.stat}>
        <Text style={styles.value}>
          {data.chairs.available}/{data.chairs.active}
        </Text>
        <Text style={styles.label}>{t.chairsFreeLabel}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.value}>
          {data.staff.available}/{data.staff.active}
        </Text>
        <Text style={styles.label}>{t.barbersFreeLabel}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.value}>{data.waitingCustomers}</Text>
        <Text style={styles.label}>{t.waitingLabel}</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.value}>
          {data.averageEstimatedWaitMinutes !== null ? `~${data.averageEstimatedWaitMinutes}m` : '—'}
        </Text>
        <Text style={styles.label}>{t.avgWaitLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space[3],
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[3],
    marginBottom: space[4],
  },
  stat: { minWidth: 64 },
  value: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  label: { fontFamily: font.bodyMedium, fontSize: 10, color: color.muted, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.3 },
});
