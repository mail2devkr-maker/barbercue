import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { UiStrings } from '@barbercue/shared';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { useLanguage } from '../../lib/language-context';
import { openLocationSettings, type DeviceLocationFailure } from '../../lib/location/device-location';
import { useLocationSelection } from '../../lib/location/location-context';
import {
  CITY_SEARCH_MIN_LENGTH,
  CitySearchError,
  cachedAvailableCities,
  fetchAvailableCities,
  searchCities,
  type CitySearchFailureKind,
} from '../../lib/location/city-api';
import {
  cityKey,
  citySubtitle,
  filterCitiesLocally,
  fullLocationLabel,
  type SelectableCity,
} from '../../lib/location/selection';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Mounted once (see App.tsx). The location pill and the City / Location field only ever call
 * `openSelector()`; this is what they open. Nothing in here touches GPS until the customer taps
 * "Use my current location".
 */
export function LocationSelectorHost() {
  const { selectorOpen, closeSelector } = useLocationSelection();
  return (
    <Modal visible={selectorOpen} animationType="slide" onRequestClose={closeSelector} testID="location-selector">
      {/* Modal renders nothing while hidden, so this body — and its search state — is fresh on every open. */}
      <SelectorBody />
    </Modal>
  );
}

type AvailableState = { status: 'loading' | 'ready' | 'error'; cities: SelectableCity[] };
type SearchState = {
  status: 'idle' | 'loading' | 'ready' | 'failed';
  forQuery: string;
  cities: SelectableCity[];
  /** Why a failed search failed — kept apart from "found nothing", which is a successful search. */
  failure: CitySearchFailureKind | null;
  /** Legacy backends only: cities that have an active shop; any other result has none yet. */
  activeShopKeys: ReadonlySet<string> | null;
};
const IDLE_SEARCH: SearchState = { status: 'idle', forQuery: '', cities: [], failure: null, activeShopKeys: null };

function gpsMessage(reason: DeviceLocationFailure, t: UiStrings): string {
  switch (reason) {
    case 'services_off':
      return t.gpsServicesOff;
    case 'denied':
      return t.gpsPermissionDenied;
    case 'blocked':
      return t.gpsPermissionBlocked;
    case 'timeout':
      return t.gpsTimedOut;
    default:
      return t.gpsUnavailable;
  }
}

function SelectorBody() {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const { selection, recents, gps, closeSelector, selectCity, selectCurrentLocation, dismissGpsError, cancelGpsDetection } =
    useLocationSelection();

  const [query, setQuery] = useState('');
  const [available, setAvailable] = useState<AvailableState>(() => {
    const cached = cachedAvailableCities();
    return cached ? { status: 'ready', cities: cached } : { status: 'loading', cities: [] };
  });
  const [search, setSearch] = useState<SearchState>(IDLE_SEARCH);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const searchSequence = useRef(0);
  const trimmed = query.trim();
  const searching = trimmed.length >= CITY_SEARCH_MIN_LENGTH;

  const loadAvailable = useCallback(() => {
    setAvailable((current) => (current.cities.length > 0 ? current : { status: 'loading', cities: [] }));
    fetchAvailableCities()
      .then((cities) => setAvailable({ status: 'ready', cities }))
      .catch(() => setAvailable((current) => (current.cities.length > 0 ? current : { status: 'error', cities: [] })));
  }, []);

  useEffect(() => {
    loadAvailable();
  }, [loadAvailable]);

  // Debounced backend search. Every keystroke takes a new sequence number first, so a slow response
  // for "haj" can never overwrite the results for "hajipur" that the customer has typed since.
  useEffect(() => {
    const sequence = ++searchSequence.current;
    if (!searching) {
      setSearch(IDLE_SEARCH);
      return undefined;
    }
    setSearch((current) => ({ ...current, status: 'loading', failure: null }));
    const timer = setTimeout(() => {
      searchCities(trimmed)
        .then((outcome) => {
          if (sequence === searchSequence.current) {
            setSearch({ status: 'ready', forQuery: trimmed, cities: outcome.cities, failure: null, activeShopKeys: outcome.activeShopKeys });
          }
        })
        .catch((err: unknown) => {
          if (sequence === searchSequence.current) {
            const failure: CitySearchFailureKind = err instanceof CitySearchError ? err.kind : 'NETWORK_ERROR';
            setSearch({ status: 'failed', forQuery: trimmed, cities: [], failure, activeShopKeys: null });
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, searching, searchAttempt]);

  const selectedKey = selection?.mode === 'city' ? cityKey(selection.city) : null;
  const backendReady = search.status === 'ready' && search.forQuery === trimmed;
  // Until the backend answers (or if it fails) the customer still sees instant local matches
  // from the available-cities list, so typing never leads to a dead end.
  const localMatches = searching ? filterCitiesLocally(available.cities, trimmed) : [];
  const shown = searching ? (backendReady ? search.cities : localMatches) : [];

  const renderCity = (city: SelectableCity, scope: string) => {
    const key = cityKey(city);
    const isSelected = key === selectedKey;
    const subtitle = citySubtitle(city);
    // A real city the backend found that has no active shop yet (only knowable against a legacy backend).
    const hasNoShops = scope === 'result' && backendReady && search.activeShopKeys !== null && !search.activeShopKeys.has(key);
    return (
      <Pressable
        key={`${scope}:${key}`}
        testID={`city-row-${key}`}
        onPress={() => selectCity(city)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={subtitle ? `${city.name}, ${subtitle}` : city.name}
        style={({ pressed }) => [styles.row, isSelected && styles.rowSelected, pressed && styles.rowPressed]}
      >
        <Text style={styles.rowPin}>📍</Text>
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {city.name}
          </Text>
          {subtitle ? (
            <Text style={styles.rowSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
          {hasNoShops ? (
            <Text testID={`no-shops-${key}`} style={styles.rowNoShops} numberOfLines={1}>
              {t.locationCityNoShops}
            </Text>
          ) : null}
        </View>
        {isSelected ? <Text style={styles.rowCheck}>✓</Text> : null}
      </Pressable>
    );
  };

  const gpsError = gps.status === 'error' ? gps : null;
  const detecting = gps.status === 'detecting';

  return (
    <View style={[styles.root, { paddingTop: insets.top + space[2] }]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t.locationSelectorTitle}
        </Text>
        <Pressable
          testID="location-selector-close"
          onPress={closeSelector}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t.locationCloseSelector}
          style={styles.closeButton}
        >
          <Text style={styles.closeGlyph}>✕</Text>
        </Pressable>
      </View>

      <View style={styles.searchBox}>
        <Text style={styles.searchGlyph}>⌕</Text>
        <TextInput
          testID="location-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={t.locationSearchPlaceholder}
          placeholderTextColor={fastQue.textMuted}
          selectionColor={fastQue.pink}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={t.locationSearchPlaceholder}
        />
        {query.length > 0 ? (
          <Pressable
            testID="location-search-clear"
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t.locationSearchClear}
          >
            <Text style={styles.clearGlyph}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + space[8] }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* The ONLY control that starts GPS. */}
        <Pressable
          testID="use-current-location"
          onPress={() => void selectCurrentLocation()}
          disabled={detecting}
          accessibilityRole="button"
          accessibilityLabel={t.useMyCurrentLocation}
          accessibilityState={{ busy: detecting, disabled: detecting }}
          style={({ pressed }) => [styles.gpsRow, pressed && styles.rowPressed, detecting && styles.gpsRowBusy]}
        >
          <View style={styles.gpsIcon}>
            {detecting ? <ActivityIndicator color={fastQue.text} /> : <Text style={styles.gpsIconGlyph}>◎</Text>}
          </View>
          <View style={styles.rowText}>
            <Text style={styles.gpsTitle}>{detecting ? t.locationDetectingGps : t.useMyCurrentLocation}</Text>
            <Text style={styles.rowSubtitle}>{t.useMyCurrentLocationHint}</Text>
          </View>
          {detecting ? (
            <Pressable
              testID="cancel-gps"
              onPress={cancelGpsDetection}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t.locationCloseSelector}
            >
              <Text style={styles.clearGlyph}>✕</Text>
            </Pressable>
          ) : null}
        </Pressable>

        {gpsError ? (
          <View testID="gps-error" style={styles.errorCard} accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>{gpsMessage(gpsError.reason, t)}</Text>
            <View style={styles.errorActions}>
              {gpsError.reason === 'services_off' || gpsError.reason === 'blocked' ? (
                <Pressable testID="gps-open-settings" onPress={() => void openLocationSettings(gpsError.reason)} accessibilityRole="button" style={styles.errorButton}>
                  <Text style={styles.errorButtonText}>{t.openSettingsAction}</Text>
                </Pressable>
              ) : (
                <Pressable testID="gps-retry" onPress={() => void selectCurrentLocation()} accessibilityRole="button" style={styles.errorButton}>
                  <Text style={styles.errorButtonText}>{t.locationRetry}</Text>
                </Pressable>
              )}
              <Pressable onPress={dismissGpsError} accessibilityRole="button" style={styles.errorDismiss}>
                <Text style={styles.errorDismissText}>✕</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {selection && !searching ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t.locationCurrentlySelected}</Text>
            <View testID="current-selection" style={styles.currentCard}>
              <Text style={styles.rowPin}>📍</Text>
              <Text style={styles.currentText} numberOfLines={2}>
                {fullLocationLabel(selection, t)}
              </Text>
            </View>
          </View>
        ) : null}

        {searching ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t.locationSearchResults}</Text>
            {search.status === 'failed' && search.forQuery === trimmed ? (
              <View testID={`search-failed-${search.failure ?? 'NETWORK_ERROR'}`}>
                <Text style={styles.note}>
                  {search.failure === 'BACKEND_UNSUPPORTED' ? t.locationSearchUnsupported : t.locationSearchNetworkError}
                </Text>
                {search.failure !== 'BACKEND_UNSUPPORTED' ? (
                  <Pressable testID="search-retry" onPress={() => setSearchAttempt((n) => n + 1)} accessibilityRole="button" style={styles.errorButton}>
                    <Text style={styles.errorButtonText}>{t.locationRetry}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {search.status === 'loading' && !backendReady && shown.length === 0 ? (
              <View testID="search-loading" style={styles.loadingRow}>
                <ActivityIndicator color={fastQue.pink} />
              </View>
            ) : null}
            {shown.map((city) => renderCity(city, 'result'))}
            {shown.length === 0 && search.status !== 'loading' && search.status !== 'failed' ? (
              <View testID="no-cities" style={styles.empty}>
                <Text style={styles.emptyTitle}>{t.locationNoCitiesFound}</Text>
                <Text style={styles.note}>{t.locationNoCitiesFoundHint}</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <>
            {recents.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>{t.locationRecentlySelected}</Text>
                {recents.map((city) => renderCity(city, 'recent'))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t.locationAvailableCities}</Text>
              {available.status === 'loading' ? (
                <View testID="available-loading" style={styles.loadingRow}>
                  <ActivityIndicator color={fastQue.pink} />
                  <Text style={styles.note}>{t.locationLoadingCities}</Text>
                </View>
              ) : null}
              {available.status === 'error' ? (
                <View testID="available-error" style={styles.empty}>
                  <Text style={styles.note}>{t.locationCouldNotLoadCities}</Text>
                  <Pressable onPress={loadAvailable} accessibilityRole="button" style={styles.errorButton}>
                    <Text style={styles.errorButtonText}>{t.locationRetry}</Text>
                  </Pressable>
                </View>
              ) : null}
              {available.cities.map((city) => renderCity(city, 'available'))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: fastQue.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[4], paddingBottom: space[3] },
  title: { flex: 1, fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: fastQue.text },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, backgroundColor: fastQue.glassStrong },
  closeGlyph: { color: fastQue.textSecondary, fontSize: 16, fontFamily: font.bodyBold },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    marginHorizontal: space[4],
    marginBottom: space[3],
    minHeight: 52,
    paddingHorizontal: space[4],
    borderWidth: 1,
    borderColor: fastQue.borderStrong,
    borderRadius: radius.md,
    backgroundColor: fastQue.input,
  },
  searchGlyph: { color: fastQue.pink, fontSize: 20, fontFamily: font.bodyBold },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: space[3], color: fastQue.text, fontFamily: font.bodyRegular, fontSize: fontSize.base },
  clearGlyph: { color: fastQue.textSecondary, fontSize: 16, fontFamily: font.bodyBold, paddingHorizontal: space[1] },
  scroll: { flex: 1 },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[3],
    minHeight: 64,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: fastQue.borderStrong,
    backgroundColor: fastQue.card,
  },
  gpsRowBusy: { opacity: 0.85 },
  gpsIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: fastQue.pink },
  gpsIconGlyph: { color: fastQue.text, fontSize: 22, fontFamily: font.bodyBold },
  gpsTitle: { fontFamily: font.bodyBold, fontSize: fontSize.base, color: fastQue.text },
  section: { marginTop: space[2], paddingHorizontal: space[4] },
  sectionLabel: { fontFamily: font.bodyBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: fastQue.textMuted, marginBottom: space[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: 56,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginBottom: space[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowSelected: { borderColor: fastQue.borderStrong, backgroundColor: fastQue.card },
  rowPressed: { opacity: 0.7 },
  rowPin: { fontSize: 18 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.text },
  rowSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: 2 },
  rowNoShops: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.orange, marginTop: 2 },
  rowCheck: { color: fastQue.pink, fontFamily: font.bodyBold, fontSize: fontSize.lg },
  currentCard: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border, backgroundColor: fastQue.card },
  currentText: { flex: 1, fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: fastQue.text },
  note: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginBottom: space[2] },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[4] },
  empty: { alignItems: 'center', paddingVertical: space[6], gap: space[2] },
  emptyTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  errorCard: { marginHorizontal: space[4], marginBottom: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.error, backgroundColor: 'rgba(255,139,154,0.08)' },
  errorText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.text, lineHeight: 20 },
  errorActions: { flexDirection: 'row', alignItems: 'center', marginTop: space[3], gap: space[3] },
  errorButton: { paddingHorizontal: space[4], paddingVertical: space[2], minHeight: 40, justifyContent: 'center', borderRadius: radius.sm, borderWidth: 1, borderColor: fastQue.pink },
  errorButtonText: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: fastQue.pink },
  errorDismiss: { marginLeft: 'auto', padding: space[2] },
  errorDismissText: { color: fastQue.textSecondary, fontSize: 16, fontFamily: font.bodyBold },
});
