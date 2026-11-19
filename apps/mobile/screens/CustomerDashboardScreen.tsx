import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CREDITS_PATHS,
  Language,
  NOTIFICATION_PATHS,
  QUEUE_ENTRIES_PATH,
  RECENTLY_VIEWED_PATHS,
  REVIEW_PATHS,
  formatBookingArrivalTime,
  formatMoney,
  notificationTypeLabel,
  type BookingDetailDto,
  type CustomerCreditBalanceDto,
  type CustomerReviewDto,
  type NotificationDto,
  type PaginatedResult,
  type QueueEntryDetailDto,
  type RecentSalonDto,
} from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { directionsUrl } from '../lib/booking-actions';
import { isCreditsEnabled } from '../lib/feature-flags';
import { useLanguage } from '../lib/language-context';
import { greetingText, lastViewedLabel, nextBookingPath, pickNextBooking, salonProfileParams, starsText } from '../lib/customer-dashboard';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Button, Card, SafeImage, Screen, SectionHeader, Skeleton } from '../components/ui';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import type { AccountStackParamList, TabParamList } from '../navigation/types';
import { useThemedStyles, useThemeTokens, type ThemeTokens } from '../lib/theme-mode';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<AccountStackParamList, 'CustomerDashboard'>, BottomTabNavigationProp<TabParamList>>;
type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; data: T };

/**
 * Customer dashboard on mobile: website parity with /account (built by Nitesh, live on the web since
 * 14 Nov). Every figure is the customer's own data; each card loads on its own, so one failing
 * request never blanks the rest. JS only: no new native module (the website's map view needs a
 * native map and stays web-only; salons here open their directions in the maps app instead).
 */
export default function CustomerDashboardScreen() {
  const { color } = useThemeTokens();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const [queue, setQueue] = useState<QueueEntryDetailDto | null>(null);
  const [next, setNext] = useState<Load<BookingDetailDto | null>>({ state: 'loading' });
  const [credits, setCredits] = useState<Load<number>>({ state: 'loading' });
  const [recent, setRecent] = useState<Load<RecentSalonDto[]>>({ state: 'loading' });
  const [reviews, setReviews] = useState<Load<CustomerReviewDto[]>>({ state: 'loading' });
  const [activity, setActivity] = useState<Load<NotificationDto[]>>({ state: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const creditsOn = isCreditsEnabled();

  const load = useCallback(() => {
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`).then(setQueue).catch(() => undefined);
    apiFetch<PaginatedResult<BookingDetailDto>>(nextBookingPath())
      .then((page) => setNext({ state: 'ready', data: pickNextBooking(page.items) }))
      .catch(() => setNext({ state: 'error' }));
    if (creditsOn) {
      apiFetch<CustomerCreditBalanceDto>(`${CREDITS_PATHS.credits}/${CREDITS_PATHS.balance}`)
        .then((r) => setCredits({ state: 'ready', data: r.balance }))
        .catch(() => setCredits({ state: 'error' }));
    }
    apiFetch<RecentSalonDto[]>(RECENTLY_VIEWED_PATHS.recentlyViewed)
      .then((items) => setRecent({ state: 'ready', data: items.slice(0, 3) }))
      .catch(() => setRecent({ state: 'error' }));
    apiFetch<CustomerReviewDto[]>(`${REVIEW_PATHS.reviews}/${REVIEW_PATHS.mine}`)
      .then((items) => setReviews({ state: 'ready', data: items.slice(0, 2) }))
      .catch(() => setReviews({ state: 'error' }));
    apiFetch<{ items: NotificationDto[] }>(`${NOTIFICATION_PATHS.notifications}/${NOTIFICATION_PATHS.mine}`)
      .then((r) => setActivity({ state: 'ready', data: r.items.slice(0, 5) }))
      .catch(() => setActivity({ state: 'error' }))
      .finally(() => setRefreshing(false));
  }, [creditsOn]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const quick: Array<{ key: string; title: string; hint: string; onPress: () => void }> = [
    {
      key: 'book',
      title: hi ? 'अपॉइंटमेंट बुक करें' : 'Book an Appointment',
      hint: hi ? 'सैलून और समय चुनें' : 'Pick a salon and a time',
      onPress: () => navigation.navigate('SearchTab', { screen: 'SalonSearch', initial: false }),
    },
    {
      key: 'queue',
      title: hi ? 'लाइव क्यू जॉइन करें' : 'Join Live Queue',
      hint: hi ? 'अभी खुले सैलून' : 'Salons open right now',
      onPress: () => navigation.navigate('QueueTab', { screen: 'QueueHome', initial: false }),
    },
    {
      key: 'appts',
      title: hi ? 'मेरे अपॉइंटमेंट' : 'View Appointments',
      hint: hi ? 'आने वाली और पुरानी विज़िट' : 'Upcoming and past visits',
      onPress: () => navigation.navigate('BookingsTab', { screen: 'MyBookings', initial: false }),
    },
    ...(creditsOn
      ? [{ key: 'rewards', title: hi ? 'मेरे रिवॉर्ड' : 'My Rewards', hint: 'FastQue Credits', onPress: () => navigation.navigate('AccountTab', { screen: 'CreditsHistory', initial: false }) }]
      : []),
  ];

  const nextBooking = next.state === 'ready' ? next.data : null;
  const arrival = nextBooking ? formatBookingArrivalTime(nextBooking.slotStart, nextBooking.salonTimezone) : null;

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={color.accent} colors={[color.accent]} />}
      >
        <SectionHeader
          eyebrow={hi ? 'डैशबोर्ड' : 'DASHBOARD'}
          title={`${greetingText(new Date().getHours(), language)}!`}
          subtitle={hi ? 'अपने अगले शानदार लुक के लिए तैयार?' : 'Ready for your next great look?'}
        />

        <View style={styles.quickGrid}>
          {quick.map((q) => (
            <Pressable key={q.key} style={styles.quickCard} onPress={q.onPress} accessibilityRole="button" accessibilityLabel={q.title}>
              <Text style={styles.quickTitle}>{q.title}</Text>
              <Text style={styles.quickHint}>{q.hint}</Text>
            </Pressable>
          ))}
        </View>

        {queue && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{hi ? 'आपकी लाइव क्यू' : 'Your Live Queue'}</Text>
            <QueueStatusPanel entry={queue} onEntryChange={setQueue} />
            <Button title={hi ? 'लाइव क्यू ट्रैक करें' : 'Track live queue'} variant="outline" onPress={() => navigation.navigate('QueueTab', { screen: 'QueueHome', initial: false })} style={styles.action} />
          </Card>
        )}

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{hi ? 'आपका अगला अपॉइंटमेंट' : 'Your Next Appointment'}</Text>
          {next.state === 'loading' && <Skeleton style={styles.skeleton} />}
          {next.state === 'error' && <Text style={styles.meta}>{hi ? 'अपॉइंटमेंट अभी लोड नहीं हो सके।' : "Couldn't load your appointments."}</Text>}
          {nextBooking && arrival && (
            <>
              <Text style={styles.when}>{`${arrival.date} · ${arrival.time}${arrival.isDeviceLocalTimezone ? '' : hi ? ' (दुकान का समय)' : ' (shop time)'}`}</Text>
              <Text style={styles.big}>{nextBooking.salonName}</Text>
              <Text style={styles.meta}>{nextBooking.services.map((s) => s.name).join(' + ') || nextBooking.serviceName}</Text>
              {nextBooking.preferredStaffName ? <Text style={styles.meta}>{`${hi ? 'साथ में' : 'With'} ${nextBooking.preferredStaffName}`}</Text> : null}
              <Text style={styles.amount}>{formatMoney(nextBooking.payableAmount, nextBooking.currency)}</Text>
              <View style={styles.actionRow}>
                <Button title={hi ? 'विवरण' : 'View Details'} variant="outline" onPress={() => navigation.navigate('BookingsTab', { screen: 'MyBookings', initial: false })} style={styles.half} />
                <Button title={hi ? 'दिशा' : 'Directions'} onPress={() => void Linking.openURL(directionsUrl(nextBooking))} style={styles.half} />
              </View>
            </>
          )}
          {next.state === 'ready' && !nextBooking && (
            <>
              <Text style={styles.meta}>{hi ? 'आपका अगला शानदार लुक इंतज़ार कर रहा है।' : 'Your next great look is waiting.'}</Text>
              <Button title={hi ? 'सैलून ढूँढें' : 'Find a Salon'} onPress={() => navigation.navigate('SearchTab', { screen: 'SalonSearch', initial: false })} style={styles.action} />
            </>
          )}
        </Card>

        {creditsOn && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>{hi ? 'आपके रिवॉर्ड' : 'Your Rewards'}</Text>
            {credits.state === 'loading' && <Skeleton style={styles.skeletonSm} />}
            {credits.state === 'error' && <Text style={styles.meta}>{hi ? 'क्रेडिट अभी लोड नहीं हो सके।' : "Couldn't load your credits right now."}</Text>}
            {credits.state === 'ready' && (
              <>
                <Text style={styles.big}>{formatMoney(credits.data, 'INR', 'IN')}</Text>
                <Text style={styles.meta}>{hi ? 'FastQue क्रेडिट उपलब्ध' : 'FastQue Credits available'}</Text>
              </>
            )}
            <Button title={hi ? 'रिवॉर्ड देखें' : 'View Rewards'} variant="outline" onPress={() => navigation.navigate('AccountTab', { screen: 'CreditsHistory', initial: false })} style={styles.action} />
          </Card>
        )}

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{hi ? 'जहाँ छोड़ा था वहीं से' : 'Pick up where you left off'}</Text>
          {recent.state === 'loading' && <Skeleton style={styles.skeleton} />}
          {recent.state === 'error' && <Text style={styles.meta}>{hi ? 'हाल में देखे सैलून लोड नहीं हो सके।' : "Couldn't load your recently viewed salons."}</Text>}
          {recent.state === 'ready' && recent.data.length === 0 && (
            <Text style={styles.meta}>{hi ? 'जो सैलून आप देखेंगे वे यहाँ दिखेंगे।' : 'Salons you look at will show up here.'}</Text>
          )}
          {recent.state === 'ready' && recent.data.map((s) => (
            <Pressable key={s.id} style={styles.recentRow} accessibilityRole="button" accessibilityLabel={s.name}
              onPress={() => navigation.navigate('SearchTab', { screen: 'SalonProfile', params: salonProfileParams(s), initial: false })}>
              <SafeImage url={s.coverPhotoUrl} alt={s.name} style={styles.thumb} />
              <View style={styles.recentBody}>
                <Text style={styles.recentName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.meta} numberOfLines={1}>{lastViewedLabel(s.viewedAt, language)}</Text>
              </View>
            </Pressable>
          ))}
          <Button title={hi ? 'सारे हाल में देखे गए' : 'All recently viewed'} variant="outline" onPress={() => navigation.navigate('AccountTab', { screen: 'RecentlyViewed', initial: false })} style={styles.action} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{hi ? 'मेरी समीक्षाएँ' : 'My Reviews'}</Text>
          {reviews.state === 'loading' && <Skeleton style={styles.skeleton} />}
          {reviews.state === 'error' && <Text style={styles.meta}>{hi ? 'समीक्षाएँ लोड नहीं हो सकीं।' : "Couldn't load your reviews."}</Text>}
          {reviews.state === 'ready' && reviews.data.length === 0 && (
            <Text style={styles.meta}>{hi ? 'विज़िट पूरी होने के बाद आप सैलून की समीक्षा लिख सकते हैं।' : 'After a visit is completed you can review the salon.'}</Text>
          )}
          {reviews.state === 'ready' && reviews.data.map((r) => (
            <View key={r.id} style={styles.reviewRow}>
              <Text style={styles.recentName}>{r.salonName}</Text>
              <Text style={styles.stars}>{starsText(r.rating)}</Text>
              {r.comment ? <Text style={styles.meta} numberOfLines={2}>{r.comment}</Text> : null}
            </View>
          ))}
          <Button title={hi ? 'सारी समीक्षाएँ' : 'All reviews'} variant="outline" onPress={() => navigation.navigate('AccountTab', { screen: 'MyReviews', initial: false })} style={styles.action} />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{hi ? 'हाल की गतिविधि' : 'Recent Activity'}</Text>
          {activity.state === 'loading' && <Skeleton style={styles.skeleton} />}
          {activity.state === 'error' && <Text style={styles.meta}>{hi ? 'गतिविधि लोड नहीं हो सकी।' : "Couldn't load recent activity."}</Text>}
          {activity.state === 'ready' && activity.data.length === 0 && (
            <Text style={styles.meta}>{hi ? 'बुकिंग अपडेट, क्यू अलर्ट और क्रेडिट यहाँ दिखेंगे।' : 'Booking updates, queue alerts and credits will show up here.'}</Text>
          )}
          {activity.state === 'ready' && activity.data.map((n) => (
            <View key={n.id} style={styles.activityRow}>
              <Text style={[styles.activityText, !n.readAt && styles.activityUnread]} numberOfLines={1}>{notificationTypeLabel(language, n.type)}</Text>
              <Text style={styles.meta}>{lastViewedLabel(n.createdAt, language)}</Text>
            </View>
          ))}
          <Button title={hi ? 'सारी सूचनाएँ' : 'All notifications'} variant="outline" onPress={() => navigation.navigate('AccountTab', { screen: 'Notifications', initial: false })} style={styles.action} />
        </Card>
        <View style={styles.bottom} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = ({ color }: ThemeTokens) => StyleSheet.create({
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3], marginBottom: space[4] },
  quickCard: { flexBasis: '47%', flexGrow: 1, backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: space[4] },
  quickTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  quickHint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  card: { marginBottom: space[3] },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[2] },
  big: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  when: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent, marginBottom: 2 },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: 2 },
  amount: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink, marginTop: space[2] },
  action: { marginTop: space[3] },
  actionRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  half: { flex: 1 },
  skeleton: { height: 96, borderRadius: radius.sm },
  skeletonSm: { height: 56, borderRadius: radius.sm },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  thumb: { width: 48, height: 48, borderRadius: radius.sm },
  recentBody: { flex: 1 },
  recentName: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  reviewRow: { paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border },
  stars: { fontSize: fontSize.sm, color: color.accent },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border, gap: space[2] },
  activityText: { flex: 1, fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink },
  activityUnread: { fontFamily: font.bodySemiBold },
  bottom: { height: space[6] },
});
