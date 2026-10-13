import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { CancellationActorOrUnknown, CancellationAnalyticsDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { CANCELLATION_ACTOR_LABEL, formatMoney, formatShopDate, formatShopTime, ownerOpsPaths } from '../../lib/owner/ops';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { Chip, ChipRow, FieldLabel, Hint, StatusPill } from '../../components/owner/ops-ui';

const ACTORS: readonly { id: CancellationActorOrUnknown; color: string }[] = [
  { id: 'CUSTOMER', color: '#5b8cff' },
  { id: 'OWNER', color: fastQue.pink },
  { id: 'STAFF', color: '#ffa94d' },
  { id: 'SYSTEM', color: '#a58bff' },
  { id: 'ADMIN', color: '#e9e4f7' },
  { id: 'UNKNOWN', color: '#8d93a6' },
];
const RANGES = [
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
] as const;

/**
 * Cancelled bookings by who cancelled them. The split comes from what was recorded at the moment of
 * cancellation - never inferred from a booking's current status - and older bookings that predate that
 * record are shown as "Not recorded" rather than guessed. Live Queue outcomes are reported separately.
 */
export default function OwnerCancellationsScreen() {
  const { selectedSalonId } = useSalon();
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('30d');
  const [actor, setActor] = useState<CancellationActorOrUnknown | 'ALL'>('ALL');
  const [data, setData] = useState<CancellationAnalyticsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!selectedSalonId) return;
    const id = ++requestId.current;
    try {
      const next = await apiFetch<CancellationAnalyticsDto>(ownerOpsPaths.cancellationAnalytics(selectedSalonId, range, actor));
      if (id !== requestId.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : 'Could not load cancellations.');
    }
  }, [selectedSalonId, range, actor]);

  useEffect(() => {
    setData(null);
  }, [selectedSalonId, range, actor]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title="Choose a shop" message="Select a shop to see its cancellations." />
      </PremiumScreen>
    );
  }

  const money = (n: number) => formatMoney(n, data?.currency ?? 'INR');
  const total = data ? ACTORS.reduce((sum, a) => sum + data.byActor[a.id], 0) : 0;

  return (
    <PremiumScreen>
      <PremiumSectionHeader
        eyebrow="Business"
        title="Cancellations"
        subtitle="Online and in-shop bookings that were cancelled in the chosen period, by who cancelled them. The percentage compares them with the bookings made in the same period."
      />
      <FieldLabel>Period</FieldLabel>
      <ChipRow>
        {RANGES.map((r) => (
          <Chip key={r.id} testID={`cancel-range-${r.id}`} label={r.label} selected={range === r.id} onPress={() => setRange(r.id)} />
        ))}
      </ChipRow>
      <FieldLabel>Cancelled by</FieldLabel>
      <ChipRow>
        <Chip testID="cancel-actor-ALL" label="Everyone" selected={actor === 'ALL'} onPress={() => setActor('ALL')} />
        {ACTORS.map((a) => (
          <Chip key={a.id} testID={`cancel-actor-${a.id}`} label={CANCELLATION_ACTOR_LABEL[a.id]} selected={actor === a.id} onPress={() => setActor(a.id)} />
        ))}
      </ChipRow>

      {error && <InlineError message={error} />}
      {!data && !error && <Skeleton style={styles.skeleton} />}
      {data && (
        <View style={styles.body}>
          <View style={styles.tiles}>
            <Tile label="Cancellations" value={String(data.totalCancellations)} foot="in this period" testID="cancel-total" />
            <Tile label="Cancellation rate" value={data.cancellationRatePercent === null ? '—' : `${data.cancellationRatePercent}%`} foot={`of ${data.totalBookings} bookings made`} testID="cancel-rate" />
            <Tile label="Late-cancellation charges" value={money(data.charges.charged)} foot={`${money(data.charges.waived)} waived · ${money(data.charges.outstanding)} still due`} />
            <Tile
              label="Live Queue (separate)"
              value={String(data.liveQueue.cancelled + data.liveQueue.expired + data.liveQueue.noShow)}
              foot={`${data.liveQueue.cancelled} cancelled · ${data.liveQueue.expired} expired · ${data.liveQueue.noShow} no-show`}
            />
          </View>

          <PremiumCard style={styles.card}>
            <Text style={styles.title}>Who cancelled</Text>
            {data.totalCancellations === 0 && actor === 'ALL' ? (
              <Hint>No cancellations in this period.</Hint>
            ) : (
              <>
                <View style={styles.shareBar} accessible accessibilityRole="image" accessibilityLabel="Cancellations by who cancelled" testID="cancel-share-bar">
                  {ACTORS.filter((a) => data.byActor[a.id] > 0).map((a) => (
                    <View key={a.id} style={{ flex: data.byActor[a.id], backgroundColor: a.color }} />
                  ))}
                </View>
                {ACTORS.map((a) => (
                  <View key={a.id} style={styles.legendRow}>
                    <View style={[styles.dot, { backgroundColor: a.color }]} />
                    <Text style={styles.legendText}>{CANCELLATION_ACTOR_LABEL[a.id]}</Text>
                    <Text style={styles.legendCount}>{data.byActor[a.id]}</Text>
                  </View>
                ))}
                {total > 0 && data.unattributedCount > 0 && (
                  <Hint>
                    {`${data.unattributedCount} older cancellation${data.unattributedCount === 1 ? ' has' : 's have'} no record of who cancelled, so ${data.unattributedCount === 1 ? 'it is' : 'they are'} shown as “Not recorded” instead of being guessed.`}
                  </Hint>
                )}
              </>
            )}
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.title}>By service</Text>
            {data.byService.length === 0 ? <Hint>Nothing to show.</Hint> : data.byService.map((s) => <Bucket key={s.key} label={s.label} count={s.count} />)}
          </PremiumCard>
          <PremiumCard style={styles.card}>
            <Text style={styles.title}>Reasons given</Text>
            {data.byReason.length === 0 ? <Hint>Nothing to show.</Hint> : data.byReason.map((r) => <Bucket key={r.key} label={r.label} count={r.count} />)}
          </PremiumCard>

          <PremiumCard style={styles.card}>
            <Text style={styles.title}>Cancelled bookings</Text>
            {data.rows.length === 0 ? (
              <Hint>No cancelled bookings match.</Hint>
            ) : (
              data.rows.map((r) => (
                <View key={r.bookingId} style={styles.bookingRow} testID={`cancel-row-${r.bookingId}`}>
                  <View style={styles.legendRow}>
                    <Text style={styles.rowTitle}>{r.serviceNames.join(' + ')}</Text>
                    <StatusPill label={CANCELLATION_ACTOR_LABEL[r.actor] ?? r.actor} tone={r.actor === 'CUSTOMER' ? 'info' : r.actor === 'OWNER' ? 'danger' : r.actor === 'STAFF' ? 'warn' : 'neutral'} />
                  </View>
                  <Text style={styles.sub}>
                    Appointment {formatShopDate(r.slotStart, null)} {formatShopTime(r.slotStart, null)} · cancelled {formatShopDate(r.cancelledAt, null)} {formatShopTime(r.cancelledAt, null)}
                  </Text>
                  <Text style={styles.sub}>
                    {r.reason ? `Reason: ${r.reason}` : 'No reason given'}
                    {r.chargeStatus === null ? '' : ` · Charge ${money(r.chargeAmount ?? 0)} (${r.chargeStatus === 'WAIVED' ? 'waived' : r.chargeStatus === 'SETTLED' ? 'paid' : 'due'})`}
                  </Text>
                </View>
              ))
            )}
          </PremiumCard>
        </View>
      )}
    </PremiumScreen>
  );
}

function Tile({ label, value, foot, testID }: { label: string; value: string; foot: string; testID?: string }) {
  return (
    <View style={styles.tile} testID={testID}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.sub}>{foot}</Text>
    </View>
  );
}

function Bucket({ label, count }: { label: string; count: number }) {
  return (
    <View style={styles.legendRow}>
      <Text style={[styles.legendText, styles.flex]}>{label}</Text>
      <Text style={styles.legendCount}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 160, borderRadius: radius.lg, marginTop: space[3] },
  body: { marginTop: space[3] },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  tile: { flexBasis: '47%', flexGrow: 1, backgroundColor: fastQue.card, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.sm, padding: space[3] },
  tileLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.textSecondary },
  tileValue: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, lineHeight: lineHeightFor(fontSize.xl), color: fastQue.text },
  card: { marginBottom: space[3] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: fastQue.text, marginBottom: space[2] },
  shareBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', backgroundColor: fastQue.backgroundRaised, marginBottom: space[2] },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: 3 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: fastQue.textSecondary },
  legendCount: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.text, marginLeft: 'auto' },
  flex: { flex: 1 },
  bookingRow: { borderTopWidth: 1, borderTopColor: fastQue.border, paddingVertical: space[2] },
  rowTitle: { flex: 1, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  sub: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: fastQue.textMuted, marginTop: 2 },
});
