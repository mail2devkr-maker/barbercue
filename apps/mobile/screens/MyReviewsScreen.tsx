import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Language, REVIEW_PATHS, type CustomerReviewDto } from '@barbercue/shared';
import { apiFetch } from '../lib/api';
import { useLanguage } from '../lib/language-context';
import { salonProfileParams, starsText } from '../lib/customer-dashboard';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../components/ui';
import type { AccountStackParamList, TabParamList } from '../navigation/types';
import { useThemedStyles, useThemeTokens, type ThemeTokens } from '../lib/theme-mode';

type Nav = CompositeNavigationProp<NativeStackNavigationProp<AccountStackParamList, 'MyReviews'>, BottomTabNavigationProp<TabParamList>>;

/** The customer's own reviews, newest first (website parity: /account/reviews, read-only here). */
export default function MyReviewsScreen() {
  const { color } = useThemeTokens();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const { language } = useLanguage();
  const hi = language === Language.HI;
  const [items, setItems] = useState<CustomerReviewDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiFetch<CustomerReviewDto[]>(`${REVIEW_PATHS.reviews}/${REVIEW_PATHS.mine}`));
      setError(null);
    } catch {
      setError(hi ? 'आपकी समीक्षाएँ अभी लोड नहीं हो सकीं।' : "Couldn't load your reviews.");
    } finally {
      setRefreshing(false);
    }
  }, [hi]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={color.accent} colors={[color.accent]} />}
      >
        <SectionHeader eyebrow={hi ? 'डैशबोर्ड' : 'DASHBOARD'} title={hi ? 'मेरी समीक्षाएँ' : 'My reviews'} />
        {error && <InlineError message={error} />}
        {items === null && !error && (<><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></>)}
        {items && items.length === 0 && (
          <EmptyState
            title={hi ? 'अभी कोई समीक्षा नहीं' : 'No reviews yet'}
            message={hi ? 'विज़िट पूरी होने के बाद आप सैलून की समीक्षा लिख सकते हैं।' : 'After a visit is completed you can review the salon.'}
          />
        )}
        {items && items.map((r) => (
          <Pressable
            key={r.id}
            style={styles.card}
            onPress={() => navigation.navigate('SearchTab', { screen: 'SalonProfile', params: salonProfileParams({ countryCode: r.countryCode, citySlug: r.citySlug, slug: r.salonSlug }), initial: false })}
            accessibilityRole="button"
            accessibilityLabel={r.salonName}
          >
            <Text style={styles.name}>{r.salonName}</Text>
            <Text style={styles.stars} accessibilityLabel={`${r.rating} / 5`}>{starsText(r.rating)}</Text>
            <Text style={styles.meta}>
              {r.serviceName} · {new Date(r.visitDate).toLocaleDateString(hi ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </Text>
            {r.comment ? <Text style={styles.comment}>{r.comment}</Text> : null}
            {r.ownerResponse ? (
              <View style={styles.reply}>
                <Text style={styles.replyLabel}>{hi ? 'सैलून का जवाब' : 'Salon reply'}</Text>
                <Text style={styles.replyText}>{r.ownerResponse}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
        <View style={styles.bottom} />
      </ScrollView>
    </Screen>
  );
}

const makeStyles = ({ color }: ThemeTokens) => StyleSheet.create({
  skeleton: { height: 96, borderRadius: radius.md, marginBottom: space[3] },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.md, padding: space[4], marginBottom: space[3] },
  name: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  stars: { fontSize: fontSize.base, color: color.accent, marginTop: 2 },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: 2 },
  comment: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, marginTop: space[2] },
  reply: { marginTop: space[2], padding: space[3], borderRadius: radius.sm, backgroundColor: color.accentSoft },
  replyLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  replyText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, marginTop: 2 },
  bottom: { height: space[6] },
});
