import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import { DISCOVERY_PATHS } from '@barbercue/shared';
import type { PaginatedResult, SalonListItemDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, EmptyState, Skeleton, InlineError, SafeImage } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SalonSearch'>;

// Public discovery endpoint — no auth required, mirrors apps/web's search page.
export default function SalonSearchScreen({ navigation, route }: Props) {
  const selectedStyleName = route.params?.selectedStyleName;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
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
      setError(err instanceof ApiError ? err.message : 'Could not search salons.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSearch(isRefresh = false) {
    return runSearch(isRefresh, nearMe);
  }

  // "Near Me" (Phase 4) — expo-location's foreground permission flow, no paid Maps/geocoding SDK.
  // Denial/unavailability degrades gracefully to the existing text search rather than blocking the
  // screen (see the caught branches below).
  async function handleNearMe() {
    setLocating(true);
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission was denied. Try searching by name instead.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: position.coords.latitude, lng: position.coords.longitude };
      setNearMe(coords);
      await runSearch(false, coords);
    } catch {
      setError("Couldn't get your location. Try searching by name instead.");
    } finally {
      setLocating(false);
    }
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="Discovery" title="Find a salon" />
      {selectedStyleName && (
        <Text style={styles.styleNote}>
          Booking for the <Text style={styles.styleNoteBold}>{selectedStyleName}</Text> look — pick a shop to continue.
        </Text>
      )}

      <View style={styles.searchRow}>
        <TextInput
          style={styles.input}
          placeholder="Search by name…"
          placeholderTextColor={color.muted}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => void handleSearch()}
          returnKeyType="search"
        />
        <Button title="Search" onPress={() => void handleSearch()} loading={loading} style={styles.searchButton} />
      </View>

      <Button
        title={locating ? 'Locating…' : nearMe ? 'Near me ✓' : 'Near me'}
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
        <EmptyState title="No salons found" message="Try a different name, or clear the search to browse everything." />
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
                {(item.isOpenNow !== null || item.distanceKm !== null) && (
                  <Text style={styles.cardMeta}>
                    {item.isOpenNow !== null ? (item.isOpenNow ? 'Open now' : 'Closed now') : ''}
                    {item.isOpenNow !== null && item.distanceKm !== null ? ' · ' : ''}
                    {item.distanceKm !== null ? `${item.distanceKm} km away` : ''}
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
  },
  cardImage: { width: 72, height: 72, borderRadius: radius.sm, marginRight: space[3] },
  cardBody: { flex: 1, justifyContent: 'center' },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  verifiedMark: { color: color.success, fontFamily: font.bodyBold },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  cardMeta: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.gold, marginTop: space[1] },
});
