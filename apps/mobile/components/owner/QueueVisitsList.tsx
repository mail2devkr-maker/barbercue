import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  type OwnerBookingFilter,
  type PaginatedResult,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { color, font, fontSize, space } from '../../lib/theme';
import { Button, Card } from '../ui';

/**
 * Website parity for apps/web/components/bookings/OwnerQueueVisits.tsx: customers who joined the
 * Live Queue directly, shown under the owner's Bookings for the same filter (queue rows are never
 * turned into fake bookings, and appointment check-ins are not duplicated).
 */
const PAGE_SIZE = 20;

export function QueueVisitsList({ salonId, filter, language }: { salonId: string; filter: OwnerBookingFilter; language: Language }) {
  const hi = language === Language.HI;
  const [items, setItems] = useState<QueueEntryDetailDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (nextCursor?: string, append = false) => {
    const request = ++requestId.current;
    if (append) setLoadingMore(true);
    else { setLoading(true); setError(null); }
    const query = new URLSearchParams({ filter, limit: String(PAGE_SIZE) });
    if (nextCursor) query.set('cursor', nextCursor);
    try {
      const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.queue}/visits`;
      const result = await apiFetch<PaginatedResult<QueueEntryDetailDto>>(`${base}?${query.toString()}`);
      if (request !== requestId.current) return;
      setItems((prior) => (append ? [...prior, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (err) {
      if (request !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : hi ? 'लाइव कतार विज़िट लोड नहीं हो सकीं।' : 'Could not load Live Queue visits.');
    } finally {
      if (request === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [salonId, filter, hi]);

  useEffect(() => {
    void load();
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    const refresh = (event?: { salonId?: string }) => { if (!event?.salonId || event.salonId === salonId) void load(); };
    socket.on('queue.updated', refresh);
    const unsubscribe = onReconnect(() => void load());
    return () => {
      requestId.current += 1; // ignore stale responses after a shop or filter change
      socket.off('queue.updated', refresh);
      unsubscribe();
    };
  }, [salonId, load]);

  const statusText = (entry: QueueEntryDetailDto): string => {
    if (entry.phase === 'ASSIGNED') return hi ? 'असाइन · शुरू नहीं' : 'Assigned · not started';
    if (entry.status === 'NO_SHOW') return hi ? 'नहीं आए' : 'No-show';
    if (entry.status === 'IN_SERVICE') return hi ? 'सेवा जारी' : 'In service';
    return entry.status.charAt(0) + entry.status.slice(1).toLowerCase();
  };

  return (
    <View style={styles.section} accessibilityLabel={hi ? 'लाइव कतार विज़िट' : 'Live Queue visits'}>
      <Text style={styles.heading}>{hi ? 'लाइव कतार विज़िट' : 'Live Queue visits'}</Text>
      <Text style={styles.muted}>{hi
        ? 'जो ग्राहक सीधे लाइव कतार में जुड़े। अपॉइंटमेंट चेक-इन ऊपर अपॉइंटमेंट में दिखते हैं, दोहराए बिना।'
        : 'Customers who joined the Live Queue directly. Appointment check-ins are shown above under appointments, without duplicates.'}</Text>
      {!!error && <Text style={styles.error}>{error}</Text>}
      {loading ? <Text style={styles.muted}>{hi ? 'लोड हो रहा है…' : 'Loading Live Queue visits…'}</Text>
        : items.length === 0 ? <Text style={styles.muted}>{hi ? 'इस दृश्य में अभी कोई लाइव कतार विज़िट नहीं।' : 'No Live Queue visits in this view yet.'}</Text>
        : items.map((entry) => (
          <Card key={entry.id} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.title}>{`#${entry.tokenNumber} · ${entry.serviceName || (hi ? 'सेवा नहीं चुनी' : 'Service not selected')}`}</Text>
              <Text style={styles.badge}>{statusText(entry)}</Text>
            </View>
            <Text style={styles.muted}>
              {new Date(entry.joinedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
              {' · '}{entry.customerName?.trim() || `${hi ? 'ग्राहक' : 'Customer'} #${entry.tokenNumber}`}
              {entry.assignedStaffName ? ` · ${entry.assignedStaffName}` : ''}
            </Text>
          </Card>
        ))}
      {cursor && (
        <Button title={loadingMore ? (hi ? 'लोड हो रहा है…' : 'Loading…') : (hi ? 'और लाइव कतार विज़िट' : 'Load more Live Queue visits')} variant="outline" onPress={() => void load(cursor, true)} disabled={loadingMore} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: space[4], gap: space[2] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs },
  error: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.sm },
  card: { marginBottom: space[2] },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] },
  title: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, flex: 1 },
  badge: { fontFamily: font.bodyBold, color: color.gold, fontSize: 11, textTransform: 'uppercase' },
});
