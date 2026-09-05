import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { DISCOVERY_PATHS, formatMoney } from '@barbercue/shared';
import type { PaginatedResult, SalonListItemDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, EmptyState, Skeleton, InlineError, SafeImage } from '../components/ui';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SalonSearch'>;

// Public discovery endpoint — no auth required, mirrors apps/web's search page.
export default function SalonSearchScreen({ navigation, route }: Props) {
  const { t } = useLanguage();
  const selectedStyleName = route.params?.selectedStyleName;
  const { initialQuery, initialLat, initialLng } = route.params ?? {};
  const [q, setQ] = useState(initialQuery ?? '');
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(
    initialLat !== undefined && initialLng !== undefined ? { lat: initialLat, lng: initialLng } : null,
  );
  const [locating, setLocating] = useState(false);

  async function runSearch(isRefresh: boolean, coords: { lat: number; lng: number } | null) {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (coords) {
        params.set('lat', String(coords.lat));
        params.set('lng', String(coords.lng));
      }
      const result = await apiFetch<PaginatedResult<SalonListItemDto>>(
        `${DISCOVERY_PATHS.salons}?${params.toString()}`,
      );
      setResults(result.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotSearchSalons);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSearch(isRefresh = false) {
    return runSearch(isRefresh, nearMe);
  }

  // Home's search card / Popular Services chips hand off a query (and, when already known,
  // coordinates) via route params rather than this screen re-deriving them — runs once per mount,
  // not on every param change, so returning to this same screen instance later doesn't re-fire a
  // stale search.
  useEffect(() => {
    if (initialQuery || (initialLat !== undefined && initialLng !== undefined)) {
      void runSearch(false, initialLat !== undefined && initialLng !== undefined ? { lat: initialLat, lng: initialLng } : null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Near Me" (Phase 4) — expo-location's foreground permission flow, no paid Maps/geocoding SDK.
  // Denial/unavailability degrades gracefully to the existing text search rather than blocking the
  // screen (see the caught branches below).
  async function handleNearMe() {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError(t.locationDenied);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setNearMe(coords);
      await runSearch(false, coords);
    } catch {
      setError(t.couldNotGetLocation);
    } finally {
      setLocating(false);
    }
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.discoveryEyebrow} title={t.findASalonSearchTitle} />
      {selectedStyleName && (
        <Text style={styles.styleNote}>
          {t.bookingForTheLookPrefix}<Text style={styles.styleNoteBold}>{selectedStyleName}</Text>{t.bookingForTheLookSuffix}
        </Text>
      )}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder={t.searchByNamePlaceholder}
          placeholderTextColor={color.muted}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => void handleSearch()}
          returnKeyType="search"
        />
        <Button title={t.searchAction} onPress={() => void handleSearch()} loading={loading} style={styles.searchButton} />
      </View>

      <Button
        title={locating ? t.locatingAction : nearMe ? t.nearMeFound : t.nearMe}
        variant="outline"
        onPress={() => void handleNearMe()}
        loading={locating}
        style={styles.nearMeButton}
      />

      {error && <InlineError message={error} />}

      {loading && !refreshing ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : searched && !error && results.length === 0 ? (
        <EmptyState title={t.noSalonsFoundTitle} message={t.noSalonsFoundHint} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleSearch(true)} tintColor={color.accent} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() =>
                navigation.navigate('SalonProfile', {
                  countryCode: item.countryCode,
                  citySlug: item.citySlug,
                  salonSlug: item.slug,
                  selectedStyleName,
                })
              }
            >
              <SafeImage url={item.coverPhotoUrl} alt={item.name} style={styles.cardImage} />
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>
                  {item.name}
                  {item.verified && <Text style={styles.verifiedMark}> ✓</Text>}
                </Text>
                <Text style={styles.cardSubtitle}>{item.addressLine}</Text>
                {item.ratingCount > 0 && (
                  <Text style={styles.cardMeta}>
                    ★ {item.ratingAverage?.toFixed(1)} ({item.ratingCount})
                  </Text>
                )}
                {item.priceMin !== null && (
                  <Text style={styles.cardMeta}>
                    {t.startingPricePrefix}{formatMoney(item.priceMin, item.currency, item.countryCode)}
                  </Text>
                )}
                {(item.isOpenNow !== null || item.distanceKm !== null) && (
                  <Text style={styles.cardMeta}>
                    {item.isOpenNow !== null ? (item.isOpenNow ? t.openNowLabel : t.closedNowLabel) : ''}
                    {item.isOpenNow !== null && item.distanceKm !== null ? ' · ' : ''}
                    {item.distanceKm !== null ? `${item.distanceKm}${t.kmAwaySuffix}` : ''}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  styleNote: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: -space[2], marginBottom: space[3] },
  styleNoteBold: { fontFamily: font.bodySemiBold, color: color.ink },
  searchRow: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  input: {
    flex: 1,
    minHeight: 50,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
  },
  searchButton: { flexBasis: 110, flexGrow: 0 },
  nearMeButton: { marginBottom: space[4] },
  skeletonStack: { gap: space[3] },
  skeletonCard: { height: 84, borderRadius: radius.lg },
  listContent: { paddingBottom: space[6] },
  card: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[3],
    marginBottom: space[3],
    shadowColor: color.ink,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  cardImage: { width: 84, height: 84, borderRadius: radius.md, marginRight: space[3] },
  cardBody: { flex: 1, justifyContent: 'center' },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  verifiedMark: { color: color.success, fontFamily: font.bodyBold },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  cardMeta: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.gold, marginTop: space[1] },
});
