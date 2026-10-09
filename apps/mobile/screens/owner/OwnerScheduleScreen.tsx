import { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  type OwnerBookingDetailDto,
  type PaginatedResult,
  type SalonStaffDto,
  type SalonTimezoneResultDto,
  type UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import {
  addDays,
  bookingsForDatePath,
  formatClock,
  formatDateHeading,
  groupBookingsByBarber,
  isPreferredOnly,
  todayInZone,
} from '../../lib/owner/schedule';
import { timezonePath } from '../../lib/owner/analytics';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';

const MAX_PAGES = 20;

async function fetchDay(salonId: string, date: string): Promise<OwnerBookingDetailDto[]> {
  const items: OwnerBookingDetailDto[] = [];
  let cursor: string | undefined;
  // A shop's single day is a handful of pages at most; looped (not capped at one) so a busy day is
  // never silently truncated.
  for (let guard = 0; guard < MAX_PAGES; guard += 1) {
    const page = await apiFetch<PaginatedResult<OwnerBookingDetailDto>>(bookingsForDatePath(salonId, date, cursor));
    items.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

function statusLabel(t: UiStrings, status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return t.statusConfirmed;
    case 'CANCELLED':
      return t.statusCancelled;
    case 'COMPLETED':
      return t.statusCompleted;
    case 'NO_SHOW':
      return t.statusNoShow;
    default:
      return status.replace(/_/g, ' ').toLowerCase();
  }
}

/**
 * The shop's day laid out by barber, in the shop's own time zone. Reads the same bookings endpoint
 * as the website's Day schedule and groups them the same way (assigned barber, else the customer's
 * preference, else "No preference"). A phone is not a wide grid, so each barber is a section with
 * their bookings in time order rather than a column.
 */
export default function OwnerScheduleScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t, language } = useLanguage();
  const [zone, setZone] = useState<string | null | undefined>(undefined);
  const [date, setDate] = useState<string | null>(null);
  const [staff, setStaff] = useState<SalonStaffDto[]>([]);
  const [bookings, setBookings] = useState<OwnerBookingDetailDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(
    async (salonId: string, day: string | null, isRefresh: boolean) => {
      const request = ++requestRef.current;
      if (isRefresh) setRefreshing(true);
      setError(null);
      try {
        const tz = await apiFetch<SalonTimezoneResultDto>(timezonePath(salonId));
        if (request !== requestRef.current) return;
        setZone(tz.timezone);
        if (!tz.timezone) {
          setBookings(null);
          return;
        }
        const targetDay = day ?? todayInZone(tz.timezone);
        const [members, list] = await Promise.all([
          apiFetch<SalonStaffDto[]>(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.staff}`),
          fetchDay(salonId, targetDay),
        ]);
        if (request !== requestRef.current) return;
        setDate(targetDay);
        setStaff(members);
        setBookings(list);
      } catch (err) {
        if (request !== requestRef.current) return;
        setBookings(null);
        setError(err instanceof ApiError ? err.message : t.scheduleLoadFailed);
      } finally {
        if (request === requestRef.current) setRefreshing(false);
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      setZone(undefined);
      setDate(null);
      setBookings(null);
      if (selectedSalonId) void load(selectedSalonId, null, false);
      else requestRef.current += 1;
    }, [selectedSalonId, load]),
  );

  const columns = useMemo(() => (bookings ? groupBookingsByBarber(bookings, staff) : []), [bookings, staff]);

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  const go = (nextDate: string) => {
    setBookings(null);
    void load(selectedSalonId, nextDate, false);
  };
  const today = zone ? todayInZone(zone) : null;

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(selectedSalonId, date, true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={t.scheduleTitle} subtitle={t.scheduleSubtitle} />
      <SalonSwitcher />

      {zone === null ? (
        <Text testID="schedule-no-timezone" style={styles.notice}>
          {t.scheduleNoTimezone}
        </Text>
      ) : null}
      {error ? <InlineError message={error} /> : null}

      {zone ? (
        <View style={styles.nav}>
          <PremiumButton testID="schedule-prev" title="‹" variant="secondary" accessibilityLabel={t.schedulePrevDay} onPress={() => date && go(addDays(date, -1))} style={styles.navButton} />
          <View style={styles.navCenter}>
            <Text testID="schedule-date" style={styles.dateText}>
              {date ? formatDateHeading(date, language === 'HI' ? 'hi-IN' : 'en-IN') : '…'}
            </Text>
            {date && today && date !== today ? (
              <PremiumButton testID="schedule-today" title={t.scheduleToday} variant="secondary" onPress={() => go(today)} style={styles.todayButton} />
            ) : null}
          </View>
          <PremiumButton testID="schedule-next" title="›" variant="secondary" accessibilityLabel={t.scheduleNextDay} onPress={() => date && go(addDays(date, 1))} style={styles.navButton} />
        </View>
      ) : null}
      {zone ? <Text style={styles.zone}>{t.scheduleTimesIn.replace('{zone}', zone)}</Text> : null}

      {zone && bookings === null && !error ? <Skeleton style={styles.skeleton} /> : null}
      {bookings && bookings.length === 0 ? (
        <Text testID="schedule-empty" style={styles.empty}>
          {t.scheduleNoBookings}
        </Text>
      ) : null}

      {zone &&
        columns.map((column) => (
          <PremiumCard key={column.key} style={styles.column} testID={`schedule-column-${column.key}`}>
            <Text style={styles.columnTitle}>{column.label ?? t.scheduleNoPreference}</Text>
            {column.bookings.map((booking) => (
              <View key={booking.id} style={styles.booking} testID={`schedule-booking-${booking.id}`}>
                <Text style={styles.time}>
                  {formatClock(booking.slotStart, zone)} – {formatClock(booking.slotEnd, zone)}
                </Text>
                <View style={styles.bookingBody}>
                  <Text style={styles.service} numberOfLines={2}>
                    {booking.serviceName}
                  </Text>
                  <Text style={styles.meta}>
                    {statusLabel(t, booking.status)}
                    {isPreferredOnly(booking) ? ` · ${t.schedulePreferred}` : ''}
                    {booking.customerPhone ? ` · ${booking.customerPhone}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </PremiumCard>
        ))}
    </PremiumScreen>
  );
}

const styles = StyleSheet.create({
  notice: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.orange, marginVertical: space[3] },
  nav: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginVertical: space[3] },
  navButton: { minWidth: 48 },
  navCenter: { flex: 1, alignItems: 'center', gap: space[1] },
  dateText: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: fastQue.text, textAlign: 'center' },
  todayButton: { alignSelf: 'center' },
  zone: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginBottom: space[3], textAlign: 'center' },
  skeleton: { height: 100, borderRadius: radius.lg },
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: fastQue.textMuted, textAlign: 'center', marginTop: space[5] },
  column: { marginBottom: space[3] },
  columnTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text, marginBottom: space[2] },
  booking: { flexDirection: 'row', gap: space[3], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: fastQue.border },
  time: { width: 112, fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.pink },
  bookingBody: { flex: 1, minWidth: 0 },
  service: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: 2 },
});
