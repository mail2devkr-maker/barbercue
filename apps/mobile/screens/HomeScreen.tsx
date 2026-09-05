import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import {
  ImageBackground,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BOOKING_PATHS,
  CREDITS_PATHS,
  QUEUE_ENTRIES_PATH,
  formatMoney,
  type BookingDetailDto,
  type CustomerCreditBalanceDto,
  type Language,
  type PaginatedResult,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { dateLocaleFor } from '../lib/date-locale';
import { useUnreadNotificationCount } from '../lib/notifications';
import { useLanguage } from '../lib/language-context';
import { useAuth } from '../lib/auth-context';
import { resolveHomeLocation } from '../lib/home-location';
import { color, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { Card, Button, Skeleton, NotificationBell, LanguageSwitcher } from '../components/ui';
import { TabIcon } from '../components/ui/TabIcon';
import { EDITORIAL_ASSET_URL } from '../lib/editorial';
import type { HomeStackParamList, TabParamList } from '../navigation/types';

type Props = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, 'Home'>,
  BottomTabScreenProps<TabParamList>
>;

const ACTIVE_QUEUE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

// Real, already-supported free-text categories only — each one is a genuine match against
// Service.name/Service.category (see salons.service.ts's `service`/`q` filters), never an
// invented taxonomy. Labels are localized (t.categoryXxx); values are the actual search text sent.
const POPULAR_SERVICE_CATEGORIES = [
  { key: 'categoryHaircut', value: 'Haircut' },
  { key: 'categoryBeardTrim', value: 'Beard Trim' },
  { key: 'categoryFade', value: 'Fade' },
  { key: 'categoryShave', value: 'Shave' },
  { key: 'categoryNails', value: 'Nails' },
  { key: 'categorySpa', value: 'Spa' },
] as const;

function formatSlot(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(dateLocaleFor(language), {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeQueueEntry, setActiveQueueEntry] = useState<QueueEntryDetailDto | null>(null);
  const [upcomingBooking, setUpcomingBooking] = useState<BookingDetailDto | null>(null);
  const [creditsBalance, setCreditsBalance] = useState<number | null>(null);
  const unreadCount = useUnreadNotificationCount();
  const { t, language } = useLanguage();
  const { status } = useAuth();

  const [locationLabel, setLocationLabel] = useState<string | null>(null);
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  const [searchMode, setSearchMode] = useState<'barber' | 'salon'>('barber');
  const [query, setQuery] = useState('');

  const load = useCallback(async (isRefresh: boolean) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [queueEntry, bookingsPage] = await Promise.all([
        apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`).catch(() => null),
        apiFetch<PaginatedResult<BookingDetailDto>>(`${BOOKING_PATHS.bookings}/${BOOKING_PATHS.mine}`).catch(
          () => null,
        ),
      ]);
      setActiveQueueEntry(queueEntry && ACTIVE_QUEUE_STATUSES.has(queueEntry.status) ? queueEntry : null);
      const now = Date.now();
      const nextUpcoming =
        bookingsPage?.items.find((b) => b.status === 'CONFIRMED' && new Date(b.slotStart).getTime() > now) ?? null;
      setUpcomingBooking(nextUpcoming);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch every time Home regains focus (e.g. returning from booking/queue flows), not just on
  // first mount — the whole point of these cards is that they reflect current state.
  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  // FastQue Credits — only when signed in and loaded; never a fabricated balance for a guest or a
  // still-loading customer (the shortcut below shows just the label until this resolves).
  useFocusEffect(
    useCallback(() => {
      if (status !== 'authenticated') {
        setCreditsBalance(null);
        return;
      }
      let cancelled = false;
      apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
        .then((result) => {
          if (!cancelled) setCreditsBalance(result.balance);
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [status]),
  );

  // promptIfNeeded: false — only ever reads a permission the customer already granted elsewhere
  // (e.g. via SalonSearchScreen's "Near Me"). Home never shows its own permission dialog until the
  // customer explicitly taps the location pill (handleChooseLocation below).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      resolveHomeLocation(false).then((result) => {
        if (!cancelled && result) {
          setLocationLabel(result.label);
          setLocationCoords(result.coords);
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  async function handleChooseLocation() {
    setLocating(true);
    try {
      const result = await resolveHomeLocation(true);
      if (result) {
        setLocationLabel(result.label);
        setLocationCoords(result.coords);
      }
    } finally {
      setLocating(false);
    }
  }

  function goSearch(params?: { initialQuery?: string }) {
    navigation.navigate('SearchTab', {
      screen: 'SalonSearch',
      params: {
        ...(params?.initialQuery ? { initialQuery: params.initialQuery } : {}),
        ...(locationCoords ? { initialLat: locationCoords.lat, initialLng: locationCoords.lng } : {}),
      },
    });
  }

  function handleFindPress() {
    goSearch({ initialQuery: query.trim() || undefined });
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>FQ</Text>
          </View>
          <Text style={styles.brandWordmark} numberOfLines={1}>
            FastQue
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.locationPill}
            onPress={handleChooseLocation}
            disabled={locating}
            accessibilityRole="button"
          >
            <View style={styles.locationDot} />
            <Text style={styles.locationPillText} numberOfLines={1}>
              {locating ? t.detectingLocationAction : locationLabel ?? t.chooseLocationAction}
            </Text>
          </Pressable>
          <LanguageSwitcher />
          <NotificationBell
            unreadCount={unreadCount}
            onPress={() => navigation.navigate('AccountTab', { screen: 'Notifications' })}
          />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} colors={[color.accent]} />}
        keyboardShouldPersistTaps="handled"
      >
        <ImageBackground source={{ uri: EDITORIAL_ASSET_URL.heroBand }} style={styles.hero} imageStyle={styles.heroImage}>
          <View style={[StyleSheet.absoluteFill, styles.heroScrim]} />
          <View style={styles.heroContent}>
            <Text style={styles.heroEyebrow}>{t.homeHeroEyebrow}</Text>
            <Text style={styles.heroHeadline}>
              {t.homeHeroHeadlineLine1}
              {'\n'}
              <Text style={styles.heroHeadlineAccent}>{t.homeHeroHeadlineLine2}</Text>
            </Text>
            <Text style={styles.heroSubcopy}>{t.homeHeroSubcopy}</Text>
            <View style={styles.benefitRow}>
              <View style={styles.benefitItem}>
                <View style={styles.benefitIconWrap}>
                  <TabIcon name="bookings" color={color.surface} size={18} />
                </View>
                <Text style={styles.benefitLabel}>{t.bookAheadKicker}</Text>
              </View>
              <View style={styles.benefitItem}>
                <View style={styles.benefitIconWrap}>
                  <TabIcon name="queue" color={color.surface} size={18} />
                </View>
                <Text style={styles.benefitLabel}>{t.joinLiveKicker}</Text>
              </View>
              <View style={styles.benefitItem}>
                <View style={styles.benefitIconWrap}>
                  <TabIcon name="offer" color={color.surface} size={18} />
                </View>
                <Text style={styles.benefitLabel}>{t.trustOffersLabel}</Text>
              </View>
            </View>
          </View>
        </ImageBackground>

        <View style={styles.searchCard}>
          <View style={styles.segmentRow}>
            <Pressable
              style={[styles.segment, searchMode === 'barber' && styles.segmentActive]}
              onPress={() => setSearchMode('barber')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'barber' }}
            >
              <Text style={[styles.segmentText, searchMode === 'barber' && styles.segmentTextActive]} numberOfLines={1}>
                {t.searchModeBarber}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.segment, searchMode === 'salon' && styles.segmentActive]}
              onPress={() => setSearchMode('salon')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'salon' }}
            >
              <Text style={[styles.segmentText, searchMode === 'salon' && styles.segmentTextActive]} numberOfLines={1}>
                {t.searchModeSalon}
              </Text>
            </Pressable>
          </View>

          <Text style={styles.fieldLabel}>{t.shopOrServiceLabel}</Text>
          <TextInput
            style={styles.searchInput}
            placeholder={t.shopOrServiceExample}
            placeholderTextColor={color.muted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleFindPress}
            returnKeyType="search"
          />

          <Text style={styles.fieldLabel}>{t.cityLocationLabel}</Text>
          <Pressable style={styles.searchInput} onPress={handleChooseLocation} disabled={locating}>
            <Text style={locationLabel ? styles.cityValueText : styles.cityPlaceholderText} numberOfLines={1}>
              {locating ? t.detectingLocationAction : locationLabel ?? t.chooseLocationAction}
            </Text>
          </Pressable>

          <Button
            title={searchMode === 'barber' ? t.findABarberAction : t.findShopsAction}
            onPress={handleFindPress}
            style={styles.ctaButton}
          />
        </View>

        <View style={styles.section}>
          {loading ? (
            <View style={styles.loadingStack}>
              <Skeleton style={styles.skeletonCard} />
            </View>
          ) : (
            <>
              {activeQueueEntry && (
                <Card style={styles.statusCard}>
                  <Text style={styles.statusEyebrow}>{t.liveQueueLabel}</Text>
                  <Text style={styles.statusTitle}>{t.tokenNumberPrefix}{activeQueueEntry.tokenNumber}</Text>
                  <Text style={styles.statusMeta}>
                    {activeQueueEntry.status === 'CALLED'
                      ? t.calledMessage
                      : activeQueueEntry.status === 'IN_SERVICE'
                        ? t.inService
                        : activeQueueEntry.position
                          ? `${t.positionPrefix}${activeQueueEntry.position}${t.positionSuffix}`
                          : activeQueueEntry.status}
                  </Text>
                  <Button title={t.viewQueueStatus} variant="secondary" onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome' })} style={styles.cardAction} />
                </Card>
              )}

              {upcomingBooking && (
                <Card style={styles.statusCard}>
                  <Text style={styles.statusEyebrow}>{t.upcomingBookingLabel}</Text>
                  <Text style={styles.statusTitle}>{upcomingBooking.serviceName}</Text>
                  <Text style={styles.statusMeta}>
                    {upcomingBooking.salonName} · {formatSlot(upcomingBooking.slotStart, language)}
                  </Text>
                  <Text style={styles.statusMeta}>{formatMoney(upcomingBooking.servicePrice, upcomingBooking.currency)}</Text>
                  <Button
                    title={t.viewBookingAction}
                    variant="secondary"
                    onPress={() =>
                      navigation.navigate('BookingsTab', { screen: 'BookingDetail', params: { bookingId: upcomingBooking.id } })
                    }
                    style={styles.cardAction}
                  />
                </Card>
              )}
            </>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>{t.popularServicesTitle}</Text>
            <Pressable onPress={() => goSearch()}>
              <Text style={styles.viewAllText}>{t.viewAllAction} →</Text>
            </Pressable>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
          {POPULAR_SERVICE_CATEGORIES.map((category) => (
            <Pressable key={category.key} style={styles.categoryChip} onPress={() => goSearch({ initialQuery: category.value })}>
              <View style={styles.categoryIconWrap}>
                <TabIcon name="shop" color={color.accent} size={20} />
              </View>
              <Text style={styles.categoryLabel} numberOfLines={1}>
                {t[category.key]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        <Pressable
          style={styles.queueBanner}
          onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome' })}
          accessibilityRole="button"
        >
          <View style={styles.queueBannerText}>
            <Text style={styles.queueBannerHeadline}>{t.queuePromoHeadlineLine1}</Text>
            <Text style={styles.queueBannerHeadline}>{t.queuePromoHeadlineLine2}</Text>
            <Text style={styles.queueBannerSubcopy}>{t.queuePromoSubcopy}</Text>
          </View>
          <View style={styles.queueBannerIconWrap}>
            <TabIcon name="queue" color={color.surface} size={26} />
          </View>
        </Pressable>

        <View style={styles.trustStrip}>
          <View style={styles.trustItem}>
            <TabIcon name="shop" color={color.gold} size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustShopsLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="account" color={color.gold} size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustExperienceLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="today" color={color.gold} size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustRealTimeLabel}</Text>
          </View>
          <View style={styles.trustItem}>
            <TabIcon name="offer" color={color.gold} size={20} />
            <Text style={styles.trustLabel} numberOfLines={2}>{t.trustOffersLabel}</Text>
          </View>
        </View>

        <View style={styles.shortcutRow}>
          <Pressable style={styles.shortcut} onPress={() => navigation.navigate('BookingsTab', { screen: 'MyBookings' })}>
            <Text style={styles.shortcutText}>{t.myBookings}</Text>
          </Pressable>
          <Pressable style={styles.shortcut} onPress={() => navigation.navigate('StyleAdvisor')}>
            <Text style={styles.shortcutText}>{t.aiStyleAdvisor}</Text>
          </Pressable>
          {status === 'authenticated' && (
            <Pressable style={styles.shortcut} onPress={() => navigation.navigate('AccountTab', { screen: 'CreditsHistory' })}>
              <Text style={styles.shortcutText} numberOfLines={1}>
                {t.fastQueCreditsShortcut}
                {creditsBalance !== null ? ` · ${formatMoney(creditsBalance, null)}` : ''}
              </Text>
            </Pressable>
          )}
          <Pressable style={styles.shortcut} onPress={() => navigation.navigate('AccountTab', { screen: 'Account' })}>
            <Text style={styles.shortcutText}>{t.accountAndPremium}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const HERO_HEIGHT = 380;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    backgroundColor: color.surface,
    gap: space[2],
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, minWidth: 0, gap: space[2] },
  brandBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.brandCoral,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  brandBadgeText: { color: color.surface, fontFamily: font.bodyBold, fontSize: 12, letterSpacing: 0.3 },
  brandWordmark: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, flexShrink: 1 },
  // Part 7 fix: the previous header row let a long title push this whole block off the right edge
  // of the screen with no way to see it (Yoga doesn't clip an overflowing sibling — it just renders
  // past the viewport). flexShrink:0 + minWidth:0 on brandRow above means the wordmark truncates
  // first, so headerActions always keeps its own guaranteed space and can never be squeezed out.
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexShrink: 0 },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 92,
    minHeight: 32,
    paddingHorizontal: space[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    gap: 4,
  },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.brandCoral, flexShrink: 0 },
  locationPillText: { fontFamily: font.bodySemiBold, fontSize: 11, lineHeight: lineHeightFor(11), color: color.ink, flexShrink: 1 },

  hero: { height: HERO_HEIGHT, justifyContent: 'flex-end' },
  heroImage: { resizeMode: 'cover' },
  heroScrim: { backgroundColor: 'rgba(15, 12, 25, 0.56)' },
  heroContent: { padding: space[5], paddingBottom: space[6] },
  heroEyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    lineHeight: lineHeightFor(11),
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: color.goldSoft,
    marginBottom: space[2],
  },
  heroHeadline: {
    fontFamily: font.displaySemiBold,
    fontSize: fontSize['2xl'],
    lineHeight: lineHeightFor(fontSize['2xl']),
    color: color.surface,
  },
  heroHeadlineAccent: { color: color.brandCoral },
  heroSubcopy: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: 'rgba(255,255,255,0.86)',
    marginTop: space[3],
    maxWidth: 320,
  },
  benefitRow: { flexDirection: 'row', gap: space[4], marginTop: space[5] },
  benefitItem: { alignItems: 'center', gap: space[1] },
  benefitIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitLabel: { fontFamily: font.bodyMedium, fontSize: 11, lineHeight: lineHeightFor(11), color: color.surface },

  searchCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: space[4],
    marginTop: -space[7],
    borderRadius: radius.lg,
    padding: space[4],
    shadowColor: color.ink,
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  segmentRow: { flexDirection: 'row', backgroundColor: color.surfaceTint, borderRadius: radius.pill, padding: 3, marginBottom: space[4] },
  segment: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, paddingHorizontal: space[2] },
  segmentActive: { backgroundColor: color.brandCoral },
  segmentText: { fontFamily: font.bodySemiBold, fontSize: 12.5, lineHeight: lineHeightFor(12.5), color: color.muted },
  segmentTextActive: { color: color.surface },
  fieldLabel: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: color.muted,
    marginBottom: space[1],
  },
  searchInput: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    color: color.ink,
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    marginBottom: space[3],
  },
  cityValueText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  cityPlaceholderText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  ctaButton: { backgroundColor: color.brandCoral, marginTop: space[1] },

  section: { paddingHorizontal: space[5], marginTop: space[6] },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  viewAllText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },

  loadingStack: { gap: space[3] },
  skeletonCard: { height: 96, borderRadius: radius.lg },
  statusCard: { marginBottom: space[4] },
  statusEyebrow: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.gold,
    marginBottom: space[1],
  },
  statusTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  statusMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: space[1] },
  cardAction: { marginTop: space[3], alignSelf: 'flex-start', minHeight: 40, paddingHorizontal: space[4] },

  categoryRow: { paddingHorizontal: space[5], gap: space[3], marginTop: space[3] },
  categoryChip: { width: 76, alignItems: 'center', gap: space[1] },
  categoryIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: color.surfaceTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.ink, textAlign: 'center' },

  queueBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: space[5],
    marginTop: space[6],
    backgroundColor: color.brandNavy,
    borderRadius: radius.lg,
    padding: space[4],
  },
  queueBannerText: { flexShrink: 1, gap: 2 },
  queueBannerHeadline: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.surface },
  queueBannerSubcopy: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: 'rgba(255,255,255,0.7)', marginTop: space[1] },
  queueBannerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: space[3],
  },

  trustStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: space[5],
    marginTop: space[6],
    gap: space[2],
  },
  trustItem: { flex: 1, alignItems: 'center', gap: space[1] },
  trustLabel: { fontFamily: font.bodyMedium, fontSize: 10.5, lineHeight: lineHeightFor(10.5), color: color.muted, textAlign: 'center' },

  shortcutRow: { paddingHorizontal: space[5], marginTop: space[6], gap: space[2] },
  shortcut: {
    minHeight: 48,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
  },
  shortcutText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
