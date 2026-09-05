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
  useWindowDimensions,
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
import { Card, Button, Skeleton, NotificationBell, LanguageSwitcher, SafeImage, GradientView } from '../components/ui';
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
  { key: 'categoryHaircut', value: 'Haircut', imageUrl: EDITORIAL_ASSET_URL.categoryHaircut },
  { key: 'categoryBeardTrim', value: 'Beard Trim', imageUrl: EDITORIAL_ASSET_URL.categoryBeardTrim },
  { key: 'categoryFade', value: 'Fade', imageUrl: EDITORIAL_ASSET_URL.categoryFade },
  { key: 'categoryShave', value: 'Shave', imageUrl: EDITORIAL_ASSET_URL.categoryShave },
  { key: 'categoryNails', value: 'Nails', imageUrl: EDITORIAL_ASSET_URL.categoryNails },
  { key: 'categorySpa', value: 'Spa', imageUrl: EDITORIAL_ASSET_URL.categorySpa },
] as const;

const GRADIENT_COLORS = [color.brandGradientStart, color.brandGradientEnd] as const;

// Below this width, one header row can't fit brand + location + language + bell without
// truncating the "FastQue" wordmark itself (observed at 320px) — the header splits into two rows
// instead: brand+bell stay on row 1 (never shrink, never truncate), location+language get a full
// row of their own with real room to breathe. 340 comfortably covers 320px devices while leaving
// 360px+ (already fine as a single row) untouched.
const NARROW_HEADER_MAX_WIDTH = 340;

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
  const { width: windowWidth } = useWindowDimensions();
  const isNarrowHeader = windowWidth <= NARROW_HEADER_MAX_WIDTH;
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

  const locationText = locating ? t.detectingLocationAction : locationLabel ?? t.chooseLocationAction;
  const locationPill = (wide: boolean) => (
    <Pressable
      style={[styles.locationPill, wide && styles.locationPillWide]}
      onPress={handleChooseLocation}
      disabled={locating}
      accessibilityRole="button"
    >
      <View style={styles.locationDot} />
      <Text style={styles.locationPillText} numberOfLines={1}>
        {locationText}
      </Text>
    </Pressable>
  );
  const bell = (
    <NotificationBell
      unreadCount={unreadCount}
      onPress={() => navigation.navigate('AccountTab', { screen: 'Notifications' })}
    />
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space[2] }]}>
        <View style={styles.headerTopRow}>
          <View style={styles.brandRow}>
            <GradientView colors={GRADIENT_COLORS} style={styles.brandBadge}>
              <Text style={styles.brandBadgeText}>FQ</Text>
            </GradientView>
            {/* Never truncated (no numberOfLines/flexShrink) — the brand name must always read in
                full; a narrow header instead gives location+language their own row below rather
                than fighting this one for space. */}
            <Text style={styles.brandWordmark}>FastQue</Text>
          </View>
          {isNarrowHeader ? (
            bell
          ) : (
            <View style={styles.headerActions}>
              {locationPill(false)}
              <LanguageSwitcher compact />
              {bell}
            </View>
          )}
        </View>
        {isNarrowHeader && (
          <View style={styles.headerBottomRow}>
            {locationPill(true)}
            <LanguageSwitcher compact />
          </View>
        )}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + space[6] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} colors={[color.accent]} />}
        keyboardShouldPersistTaps="handled"
      >
        <ImageBackground source={{ uri: EDITORIAL_ASSET_URL.heroBand }} style={styles.hero} imageStyle={styles.heroImage}>
          <View style={[StyleSheet.absoluteFill, styles.heroBaseScrim]} />
          <GradientView
            colors={['transparent', 'rgba(15, 12, 25, 0.86)']}
            direction="vertical"
            style={StyleSheet.absoluteFill}
          />
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
              style={styles.segmentPressable}
              onPress={() => setSearchMode('barber')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'barber' }}
            >
              {searchMode === 'barber' ? (
                <GradientView colors={GRADIENT_COLORS} style={styles.segment}>
                  <TabIcon name="scissors" color={color.surface} size={15} />
                  <Text style={[styles.segmentText, styles.segmentTextActive]} numberOfLines={1}>
                    {t.searchModeBarber}
                  </Text>
                </GradientView>
              ) : (
                <View style={styles.segment}>
                  <TabIcon name="scissors" color={color.muted} size={15} />
                  <Text style={styles.segmentText} numberOfLines={1}>
                    {t.searchModeBarber}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              style={styles.segmentPressable}
              onPress={() => setSearchMode('salon')}
              accessibilityRole="button"
              accessibilityState={{ selected: searchMode === 'salon' }}
            >
              {searchMode === 'salon' ? (
                <GradientView colors={GRADIENT_COLORS} style={styles.segment}>
                  <TabIcon name="salon" color={color.surface} size={15} />
                  <Text style={[styles.segmentText, styles.segmentTextActive]} numberOfLines={1}>
                    {t.searchModeSalon}
                  </Text>
                </GradientView>
              ) : (
                <View style={styles.segment}>
                  <TabIcon name="salon" color={color.muted} size={15} />
                  <Text style={styles.segmentText} numberOfLines={1}>
                    {t.searchModeSalon}
                  </Text>
                </View>
              )}
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

          <Pressable onPress={handleFindPress} accessibilityRole="button">
            <GradientView colors={GRADIENT_COLORS} style={styles.ctaButton}>
              <Text style={styles.ctaButtonText}>{searchMode === 'barber' ? t.findABarberAction : t.findShopsAction}</Text>
            </GradientView>
          </Pressable>
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
              <SafeImage url={category.imageUrl} alt={t[category.key]} style={styles.categoryThumb} />
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
          <GradientView colors={GRADIENT_COLORS} style={styles.queueBannerIconWrap}>
            <TabIcon name="queue" color={color.surface} size={24} />
          </GradientView>
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

// Tuned down from an earlier 380 — on a small Android screen (~640-680dp tall) that left too
// little of the search card + status cards visible above the fold; this still comfortably fits the
// eyebrow/headline/subcopy/benefit-row stack with room to spare.
const HERO_HEIGHT = 336;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.surface },
  scroll: { flex: 1 },

  header: {
    paddingHorizontal: space[4],
    paddingBottom: space[2],
    backgroundColor: color.surface,
    gap: space[2],
  },
  // Row 1 always: brand (never shrinks, never truncates) + bell. Part 7 fix history: the previous
  // single-row header let a long title push the language switcher off the right edge of the screen
  // entirely (Yoga doesn't clip an overflowing sibling — it just renders past the viewport). Giving
  // location+language their own row below at narrow widths (see headerBottomRow) means row 1 never
  // has more than two items competing for space, so the wordmark never needs to shrink at all.
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2] },
  headerBottomRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
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
  brandWordmark: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  locationPill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: 76,
    minHeight: 32,
    paddingHorizontal: space[2],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
    gap: 4,
  },
  // The narrow-header second row: no fixed maxWidth (the single-row pill above still caps itself
  // for the wider single-row layout) — flex:1 lets it use whatever width the language switcher
  // doesn't need, comfortably fitting "Choose location" or a real city name without truncating.
  locationPillWide: { flex: 1, maxWidth: 9999 },
  locationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.brandCoral, flexShrink: 0 },
  locationPillText: { fontFamily: font.bodySemiBold, fontSize: 11, lineHeight: lineHeightFor(11), color: color.ink, flexShrink: 1 },

  hero: { height: HERO_HEIGHT, justifyContent: 'flex-end' },
  heroImage: { resizeMode: 'cover' },
  // A light base tint (the gradient above handles the actual top->bottom legibility ramp) — keeps
  // the upper portion of the photo still clearly a real photo, not fully washed out, closer to the
  // reference's "imagery visible strongly" note than a single flat dark overlay was.
  heroBaseScrim: { backgroundColor: 'rgba(10, 8, 20, 0.22)' },
  heroContent: { padding: space[5], paddingTop: space[4], paddingBottom: space[5] },
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
    fontSize: 34,
    lineHeight: lineHeightFor(34),
    color: color.surface,
  },
  heroHeadlineAccent: { color: color.brandGradientEnd },
  heroSubcopy: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    lineHeight: lineHeightFor(fontSize.sm),
    color: 'rgba(255,255,255,0.86)',
    marginTop: space[3],
    maxWidth: 300,
  },
  benefitRow: { flexDirection: 'row', gap: space[4], marginTop: space[4] },
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
    marginTop: -56,
    borderRadius: 26,
    padding: space[4],
    shadowColor: color.ink,
    shadowOpacity: 0.18,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  segmentRow: { flexDirection: 'row', backgroundColor: color.surfaceTint, borderRadius: radius.pill, padding: 3, marginBottom: space[4], gap: 3 },
  segmentPressable: { flex: 1 },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 40,
    borderRadius: radius.pill,
    paddingHorizontal: space[2],
  },
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
  cityValueText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  cityPlaceholderText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted },
  ctaButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    marginTop: space[1],
  },
  ctaButtonText: { fontFamily: font.bodyBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.surface },

  section: { paddingHorizontal: space[5], marginTop: space[6] },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink },
  viewAllText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.accent },

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

  categoryRow: { paddingHorizontal: space[5], gap: space[4], marginTop: space[3] },
  categoryChip: { width: 72, alignItems: 'center', gap: space[2] },
  categoryThumb: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: color.surfaceTint,
  },
  categoryLabel: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.ink, textAlign: 'center' },

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
  queueBannerHeadline: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.surface },
  queueBannerSubcopy: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: 'rgba(255,255,255,0.7)', marginTop: space[1] },
  queueBannerIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
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
    gap: space[3],
  },
  trustItem: { flex: 1, alignItems: 'center', gap: space[2] },
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
  shortcutText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
});
