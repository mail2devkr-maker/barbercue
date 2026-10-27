import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { formatMoney } from '@barbercue/shared';
import type { PublicOfferDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { publicOffersRequestPath, offerProfileParams } from '../lib/customer-commerce';
import { dateLocaleFor } from '../lib/date-locale';
import { useLanguage } from '../lib/language-context';
import { color, fastQue, font, fontSize, lineHeightFor, radius, space } from '../lib/theme';
import { EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'Offers'>;
type PublicOfferPage = { items: PublicOfferDto[]; nextCursor: string | null };

function discountText(offer: PublicOfferDto): string {
  return offer.discountType === 'PERCENT'
    ? `${offer.discountValue}% off`
    : `${formatMoney(offer.discountValue, offer.currency, offer.salon.countryCode)} off`;
}

function offerKindLabel(kind: PublicOfferDto['kind']): string {
  if (kind === 'DAILY_DEAL') return 'Daily deal';
  if (kind === 'PROMOTION') return 'Promotion';
  return 'Offer';
}

export default function OffersScreen({ navigation }: Props) {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<PublicOfferDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh: boolean) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const page = await apiFetch<PublicOfferPage>(publicOffersRequestPath());
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load offers. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(false); }, [load]));

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<PublicOfferPage>(publicOffersRequestPath(nextCursor));
      setItems((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...page.items.filter((item) => !known.has(item.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more offers. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, nextCursor]);

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.trustOffersLabel} title="Offers near you" subtitle="Browse current salon offers. Sign-in and final eligibility are checked when you book." />
      {loading ? (
        <View style={styles.skeletons}><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></View>
      ) : error && items.length === 0 ? (
        <InlineError message={error} />
      ) : items.length === 0 ? (
        <EmptyState title="No current offers" message="Check back later or explore salons and services." actionLabel={t.findASalonTitle} onAction={() => navigation.navigate('SalonSearch')} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} />}
          ListHeaderComponent={error ? <InlineError message={error} /> : null}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.title}, ${discountText(item)}, ${item.salon.name}, ${item.salon.city}. View shop and book.`}
              onPress={() => navigation.navigate('SalonProfile', offerProfileParams(item))}
              style={({ pressed }) => [styles.offerCard, pressed && styles.offerCardPressed]}
            >
              <View style={styles.offerHeader}>
                <Text style={styles.offerKind}>{offerKindLabel(item.kind)}</Text>
                <View style={styles.discountPill}><Text style={styles.discountText}>{discountText(item)}</Text></View>
              </View>
              <Text style={styles.offerTitle}>{item.title}</Text>
              <Text style={styles.salonName}>{item.salon.name}</Text>
              <Text style={styles.meta}>{item.salon.city} · Valid until {new Date(item.validTo).toLocaleDateString(dateLocaleFor(language), { month: 'short', day: 'numeric' })}</Text>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              {item.prices.slice(0, 3).map((line) => (
                <View key={line.serviceId} style={styles.priceRow}>
                  <Text style={styles.serviceName} numberOfLines={1}>{line.serviceName}</Text>
                  <Text style={styles.price}>{formatMoney(line.finalPrice, line.currency, item.salon.countryCode)}</Text>
                </View>
              ))}
              {item.eligibility.accountRequired && <Text style={styles.disclaimer}>Account required · offer eligibility is confirmed at booking.</Text>}
              <Text style={styles.disclaimer}>Estimated offer pricing. The server rechecks services, eligibility and final price when you book.</Text>
              <View style={styles.ctaRow}><Text style={styles.cta}>View shop & book</Text><Text style={styles.arrow}>›</Text></View>
            </Pressable>
          )}
          ListFooterComponent={nextCursor ? (
            <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void loadMore()} style={styles.loadMore}>
              <Text style={styles.loadMoreText}>{loadingMore ? 'Loading…' : t.loadMore}</Text>
            </Pressable>
          ) : null}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  skeletons: { gap: space[3] },
  skeleton: { height: 180, borderRadius: radius.lg },
  listContent: { paddingTop: space[2], paddingBottom: space[5] },
  offerCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: color.border, borderRadius: radius.lg, padding: space[4], marginBottom: space[3] },
  offerCardPressed: { opacity: 0.82 },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space[2] },
  offerKind: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: color.gold, textTransform: 'uppercase', letterSpacing: 0.6 },
  discountPill: { backgroundColor: '#2a1119', borderColor: fastQue.borderStrong, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space[3], paddingVertical: space[2] },
  discountText: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.pink },
  offerTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink, marginTop: space[3] },
  salonName: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginTop: space[2] },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  description: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink, marginTop: space[3] },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: color.border, paddingTop: space[2], marginTop: space[2], gap: space[3] },
  serviceName: { flex: 1, fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },
  price: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  disclaimer: { fontFamily: font.bodyRegular, fontSize: 11, lineHeight: 15, color: color.muted, marginTop: space[2] },
  ctaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: space[3] },
  cta: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
  arrow: { fontFamily: font.bodyBold, fontSize: fontSize.lg, color: fastQue.pink, marginLeft: space[1] },
  loadMore: { alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  loadMoreText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent },
});
