import { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import {
  DISCOVERY_PATHS,
  PRICE_FILTER_PRESETS,
  SALON_DISCOVERY_CATEGORIES,
  formatDistance,
  formatMoney,
  validatePriceRange,
  type PriceRangeValidationError,
  type PricePreset,
  type UiStrings,
} from '@barbercue/shared';
import type { PaginatedResult, SalonListItemDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, fastQue, font, fontSize, premiumShadow, radius, space } from '../lib/theme';
import {
  EmptyState,
  Skeleton,
  InlineError,
  SafeImage,
  PremiumButton,
  PremiumScreen,
  PremiumSectionHeader,
  PremiumTextField,
  FilterDropdown,
  FilterSheet,
  type FilterDropdownOption,
} from '../components/ui';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SalonSearch'>;

// Part 8/9 — distance options. Only meaningful alongside "Near Me" coordinates (radiusKm is
// ignored server-side without a query point — see salonSearchQuerySchema's own doc comment), so
// picking a real radius itself requests location (see selectRadius below). `null` = "Any distance"
// (clears the filter, never a fabricated cap). The canonical value sent as radiusKm is always
// exactly this number, in km (never rounded — 0.1 stays 0.1); these labels are metric-only.
const DISTANCE_OPTIONS: {
  value: number | null;
  labelKey:
    | 'distanceFilterAny'
    | 'distanceFilter100m'
    | 'distanceFilter200m'
    | 'distanceFilter500m'
    | 'distanceFilter1km'
    | 'distanceFilter2km'
    | 'distanceFilter3km'
    | 'distanceFilter5km';
}[] = [
  { value: null, labelKey: 'distanceFilterAny' },
  { value: 0.1, labelKey: 'distanceFilter100m' },
  { value: 0.2, labelKey: 'distanceFilter200m' },
  { value: 0.5, labelKey: 'distanceFilter500m' },
  { value: 1, labelKey: 'distanceFilter1km' },
  { value: 2, labelKey: 'distanceFilter2km' },
  { value: 3, labelKey: 'distanceFilter3km' },
  { value: 5, labelKey: 'distanceFilter5km' },
];

const DISTANCE_ANY_ID = 'any';

function distanceIdFor(value: number | null): string {
  return value === null ? DISTANCE_ANY_ID : String(value);
}

function distanceValueFor(id: string): number | null {
  return id === DISTANCE_ANY_ID ? null : Number(id);
}

// Owner requirement: canonical discovery categories, shared with apps/web's search page so the
// two clients can never drift onto two different service-filter lists (see that module's own doc
// comment on why these specific keywords are safe substring matches against real Service rows).
// Labels are localized here (the shared list only carries the canonical English label).
type ServiceCategoryLabelKey =
  | 'serviceCategoryHair'
  | 'serviceCategoryBarber'
  | 'serviceCategoryBeard'
  | 'serviceCategoryNails'
  | 'serviceCategoryFacial'
  | 'serviceCategoryMakeup'
  | 'serviceCategoryWaxingThreading'
  | 'serviceCategorySpaMassage'
  | 'serviceCategoryBridalEvent';

const SERVICE_CATEGORY_LABEL_KEYS: Record<string, ServiceCategoryLabelKey> = {
  hair: 'serviceCategoryHair',
  barber: 'serviceCategoryBarber',
  beard: 'serviceCategoryBeard',
  nails: 'serviceCategoryNails',
  facial: 'serviceCategoryFacial',
  makeup: 'serviceCategoryMakeup',
  'waxing-threading': 'serviceCategoryWaxingThreading',
  'spa-massage': 'serviceCategorySpaMassage',
  'bridal-event': 'serviceCategoryBridalEvent',
};

const SERVICE_ALL_ID = 'all';

// Below this width a single row can't fit the search field and the Search button without
// clipping the button off the right edge (the owner-reported hard-FAIL screenshot) — stack the
// button under the field instead of forcing both into an oversized row.
const NARROW_SEARCH_ROW_WIDTH = 380;

function pricePresetLabel(preset: PricePreset, t: UiStrings): string {
  if (preset.id === 'any') return t.priceFilterAny;
  if (preset.id === 'over-1000') return t.priceFilterOver1000;
  return `${t.priceFilterUpToPrefix}${preset.max}${t.priceFilterUpToSuffix}`;
}

/** Formats the active min/max for the trigger label even when it doesn't match a preset exactly
 * (a value the customer typed into the Custom form). */
function priceRangeLabel(min: number | null, max: number | null, t: UiStrings): string {
  if (min === null && max === null) return t.priceFilterAny;
  if (min === 1000 && max === null) return t.priceFilterOver1000;
  if (min === null && max !== null) return `${t.priceFilterUpToPrefix}${max}${t.priceFilterUpToSuffix}`;
  if (min !== null && max === null) return `${t.priceFilterFromPrefix}${min}${t.priceFilterFromSuffix}`;
  return `₹${min} – ₹${max}`;
}

/** Price is its own dropdown (not a generic FilterDropdown) because it has two views inside the
 * same sheet: the scrollable ₹20-step preset list, and — once "Custom…" is picked — a min/max
 * form, matching apps/web's PriceFilterDropdown. */
function PriceFilterDropdown({
  activeMin,
  activeMax,
  onApply,
}: {
  activeMin: number | null;
  activeMax: number | null;
  onApply: (min: number | null, max: number | null) => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [minInput, setMinInput] = useState('');
  const [maxInput, setMaxInput] = useState('');
  const [customError, setCustomError] = useState<PriceRangeValidationError | null>(null);

  const activePreset = PRICE_FILTER_PRESETS.find((preset) => preset.min === activeMin && preset.max === activeMax);
  const triggerLabel = activePreset ? pricePresetLabel(activePreset, t) : priceRangeLabel(activeMin, activeMax, t);

  function close() {
    setOpen(false);
    setCustomOpen(false);
    setCustomError(null);
  }

  function openCustomForm() {
    setMinInput(activeMin === null ? '' : String(activeMin));
    setMaxInput(activeMax === null ? '' : String(activeMax));
    setCustomError(null);
    setCustomOpen(true);
  }

  function applyCustom() {
    const min = minInput.trim() === '' ? null : Number(minInput);
    const max = maxInput.trim() === '' ? null : Number(maxInput);
    const error = validatePriceRange(min, max);
    if (error) {
      setCustomError(error);
      return;
    }
    onApply(min, max);
    close();
  }

  function clearCustom() {
    onApply(null, null);
    close();
  }

  return (
    <View style={dropdownStyles.root}>
      <Text style={dropdownStyles.label}>{t.priceFilterLabel}</Text>
      <Pressable
        style={dropdownStyles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t.priceFilterLabel}: ${triggerLabel}`}
      >
        <Text style={dropdownStyles.triggerValue} numberOfLines={1}>{triggerLabel}</Text>
        <Text style={dropdownStyles.chevron} accessibilityElementsHidden importantForAccessibility="no">⌄</Text>
      </Pressable>
      <FilterSheet visible={open} title={t.priceFilterLabel} onClose={close} closeLabel={t.closeFilterMenu}>
        {!customOpen ? (
          <ScrollView contentContainerStyle={dropdownStyles.optionList} keyboardShouldPersistTaps="handled">
            {PRICE_FILTER_PRESETS.map((preset) => {
              const selected = activeMin === preset.min && activeMax === preset.max;
              return (
                <Pressable
                  key={preset.id}
                  style={dropdownStyles.option}
                  onPress={() => {
                    onApply(preset.min, preset.max);
                    close();
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[dropdownStyles.optionText, selected && dropdownStyles.optionTextSelected]}>
                    {pricePresetLabel(preset, t)}
                  </Text>
                  {selected && <Text style={dropdownStyles.optionCheck}>✓</Text>}
                </Pressable>
              );
            })}
            <Pressable style={dropdownStyles.option} onPress={openCustomForm} accessibilityRole="button">
              <Text style={dropdownStyles.optionText}>{t.priceFilterCustomLabel}</Text>
            </Pressable>
          </ScrollView>
        ) : (
          <View style={styles.customForm}>
            <Pressable onPress={() => setCustomOpen(false)} accessibilityRole="button" style={styles.customBack} hitSlop={8}>
              <Text style={styles.customBackText}>{`‹ ${t.priceFilterLabel}`}</Text>
            </Pressable>
            <Text style={styles.customFieldLabel}>{t.priceFilterMinLabel}</Text>
            <TextInput
              style={styles.customInput}
              keyboardType="numeric"
              value={minInput}
              onChangeText={setMinInput}
              placeholder="₹"
              placeholderTextColor={fastQue.textMuted}
            />
            <Text style={styles.customFieldLabel}>{t.priceFilterMaxLabel}</Text>
            <TextInput
              style={styles.customInput}
              keyboardType="numeric"
              value={maxInput}
              onChangeText={setMaxInput}
              placeholder="₹"
              placeholderTextColor={fastQue.textMuted}
            />
            {customError && (
              <Text style={styles.customError}>
                {customError === 'min-exceeds-max' ? t.priceFilterErrorMinExceedsMax : t.priceFilterErrorNegative}
              </Text>
            )}
            <View style={styles.customActions}>
              <PremiumButton title={t.priceFilterClearAction} variant="secondary" onPress={clearCustom} style={styles.customActionButton} />
              <PremiumButton title={t.priceFilterApplyAction} onPress={applyCustom} style={styles.customActionButton} />
            </View>
          </View>
        )}
      </FilterSheet>
    </View>
  );
}

// Public discovery endpoint — no auth required, mirrors apps/web's search page.
export default function SalonSearchScreen({ navigation, route }: Props) {
  const { t } = useLanguage();
  const { width: windowWidth } = useWindowDimensions();
  const stackSearchRow = windowWidth < NARROW_SEARCH_ROW_WIDTH;
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
  // Part 8/9 (distance + price + service filters).
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [service, setService] = useState<string | null>(null);

  async function runSearch(
    isRefresh: boolean,
    coords: { lat: number; lng: number } | null,
    filters: { radiusKm: number | null; priceMin: number | null; priceMax: number | null; service: string | null } = {
      radiusKm,
      priceMin,
      priceMax,
      service,
    },
  ) {
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (filters.service) params.set('service', filters.service);
      if (coords) {
        params.set('lat', String(coords.lat));
        params.set('lng', String(coords.lng));
        // radiusKm is meaningless without a query point, so it only ever gets sent alongside one.
        if (filters.radiusKm !== null) params.set('radiusKm', String(filters.radiusKm));
      }
      if (filters.priceMin !== null) params.set('priceMin', String(filters.priceMin));
      if (filters.priceMax !== null) params.set('priceMax', String(filters.priceMax));
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

  // Owner-reported discoverability fix: Distance is visible before "Near me" has ever been used —
  // picking an actual radius here is itself a location request, applied to the same search in one
  // step, rather than requiring a separate prior tap on "Near me" first.
  async function selectRadius(value: number | null) {
    if (!nearMe && value !== null) {
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
        setRadiusKm(value);
        await runSearch(false, coords, { radiusKm: value, priceMin, priceMax, service });
      } catch {
        setError(t.couldNotGetLocation);
      } finally {
        setLocating(false);
      }
      return;
    }
    setRadiusKm(value);
    void runSearch(false, nearMe, { radiusKm: value, priceMin, priceMax, service });
  }

  function selectPrice(min: number | null, max: number | null) {
    setPriceMin(min);
    setPriceMax(max);
    void runSearch(false, nearMe, { radiusKm, priceMin: min, priceMax: max, service });
  }

  function selectService(value: string | null) {
    setService(value);
    void runSearch(false, nearMe, { radiusKm, priceMin, priceMax, service: value });
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

  const distanceOptions: FilterDropdownOption[] = DISTANCE_OPTIONS.map((option) => ({
    id: distanceIdFor(option.value),
    label: t[option.labelKey],
  }));

  const serviceOptions: FilterDropdownOption[] = [
    { id: SERVICE_ALL_ID, label: t.serviceFilterAll },
    ...SALON_DISCOVERY_CATEGORIES.map((category) => ({
      id: category.id,
      label: t[SERVICE_CATEGORY_LABEL_KEYS[category.id]] ?? category.label,
    })),
  ];
  const activeServiceCategory = SALON_DISCOVERY_CATEGORIES.find((category) => category.query === service);
  const activeDistanceOption = DISTANCE_OPTIONS.find((option) => option.value === radiusKm);
  const distanceValueLabel = activeDistanceOption ? t[activeDistanceOption.labelKey] : t.distanceFilterAny;
  const serviceValueLabel = activeServiceCategory
    ? t[SERVICE_CATEGORY_LABEL_KEYS[activeServiceCategory.id]] ?? activeServiceCategory.label
    : t.serviceFilterAll;

  return (
    <PremiumScreen scroll={false} contentStyle={styles.screenContent}>
      <PremiumSectionHeader eyebrow={t.discoveryEyebrow} title={t.findASalonSearchTitle} />
      {selectedStyleName && (
        <Text style={styles.styleNote}>
          {t.bookingForTheLookPrefix}<Text style={styles.styleNoteBold}>{selectedStyleName}</Text>{t.bookingForTheLookSuffix}
        </Text>
      )}

      <View style={[styles.searchRow, stackSearchRow && styles.searchRowStacked]}>
        <PremiumTextField
          style={styles.input}
          placeholder={t.searchByNamePlaceholder}
          placeholderTextColor={fastQue.textMuted}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => void handleSearch()}
          returnKeyType="search"
        />
        <PremiumButton
          title={t.searchAction}
          onPress={() => void handleSearch()}
          loading={loading}
          style={[styles.searchButton, stackSearchRow && styles.searchButtonStacked]}
        />
      </View>

      <PremiumButton
        title={locating ? t.locatingAction : nearMe ? t.nearMeFound : t.nearMe}
        variant="quiet"
        onPress={() => void handleNearMe()}
        loading={locating}
        style={styles.nearMeButton}
      />

      {/* Owner-reported discoverability fix: always visible, not gated behind "Near me" already
          being set — selectRadius itself requests location the moment a real radius is picked, so
          the filter is reachable from the very first visit to this screen. Owner-reported cropping
          fix: these were horizontally-scrolling chip rows that clipped off the right edge on
          narrow phones — now three compact dropdown triggers that wrap onto a second row instead
          of overflowing (each has flexBasis/minWidth via FilterDropdown's own style). */}
      <View style={styles.filterRow}>
        <FilterDropdown
          label={t.distanceFilterLabel}
          valueLabel={distanceValueLabel}
          options={distanceOptions}
          selectedId={distanceIdFor(radiusKm)}
          onSelect={(id) => void selectRadius(distanceValueFor(id))}
          disabled={locating}
          closeLabel={t.closeFilterMenu}
        />
        <PriceFilterDropdown activeMin={priceMin} activeMax={priceMax} onApply={selectPrice} />
        <FilterDropdown
          label={t.serviceFilterLabel}
          valueLabel={serviceValueLabel}
          options={serviceOptions}
          selectedId={service ? (activeServiceCategory?.id ?? null) : SERVICE_ALL_ID}
          onSelect={(id) => {
            if (id === SERVICE_ALL_ID) {
              selectService(null);
              return;
            }
            const category = SALON_DISCOVERY_CATEGORIES.find((entry) => entry.id === id);
            selectService(category?.query ?? null);
          }}
          closeLabel={t.closeFilterMenu}
        />
      </View>
      {!nearMe && <Text style={styles.filterHint}>{t.distanceFilterLocationHint}</Text>}

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
                    {item.distanceKm !== null ? `${formatDistance(item.distanceKm, item.countryCode)}${t.awaySuffix}` : ''}
                  </Text>
                )}
              </View>
            </Pressable>
          )}
        />
      )}
    </PremiumScreen>
  );
}

const dropdownStyles = StyleSheet.create({
  root: { flexBasis: '31%', flexGrow: 1, minWidth: 96 },
  label: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: fastQue.textMuted,
    marginBottom: space[1],
  },
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[1],
    paddingHorizontal: space[3],
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    backgroundColor: fastQue.card,
  },
  triggerValue: { flexShrink: 1, minWidth: 0, fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text },
  chevron: { flexShrink: 0, color: fastQue.pink, fontSize: 16, fontFamily: font.bodyBold },
  optionList: { paddingHorizontal: space[3], paddingTop: space[2] },
  option: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
  },
  optionText: { fontFamily: font.bodyMedium, fontSize: fontSize.base, color: fastQue.textSecondary },
  optionTextSelected: { color: fastQue.pink, fontFamily: font.bodyBold },
  optionCheck: { color: fastQue.pink, fontFamily: font.bodyBold, fontSize: fontSize.base },
});

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  styleNote: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginTop: -space[2], marginBottom: space[3] },
  styleNoteBold: { fontFamily: font.bodySemiBold, color: fastQue.text },
  // Owner-reported cropping fix: `minWidth: 0` lets the field shrink below its own content's
  // natural width instead of forcing the row wider than the screen (the RN-web/flexbox default is
  // otherwise "never shrink below content size", the same rule that made this overflow visible in
  // the Expo web preview the owner's screenshot was taken from). On very narrow phones the row
  // itself switches to a column (searchRowStacked) so the button gets its own full-width row
  // instead of squeezing beside the field.
  searchRow: { flexDirection: 'row', gap: space[2], marginBottom: space[4] },
  searchRowStacked: { flexDirection: 'column' },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 50,
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
  },
  searchButton: { flexBasis: 110, flexGrow: 0 },
  searchButtonStacked: { flexBasis: undefined, flexGrow: 1 },
  nearMeButton: { marginBottom: space[4] },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[2] },
  filterHint: {
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    color: fastQue.textMuted,
    marginBottom: space[3],
  },
  customForm: { paddingHorizontal: space[4], paddingTop: space[3] },
  customBack: { marginBottom: space[3] },
  customBackText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.pink },
  customFieldLabel: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: fastQue.textMuted,
    marginBottom: space[1],
  },
  customInput: {
    minHeight: 48,
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[3],
    fontSize: fontSize.base,
    marginBottom: space[3],
  },
  customError: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.error, marginBottom: space[2] },
  customActions: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  customActionButton: { flex: 1 },
  skeletonStack: { gap: space[3] },
  skeletonCard: { height: 84, borderRadius: radius.lg },
  listContent: { paddingBottom: space[6] },
  card: {
    flexDirection: 'row',
    backgroundColor: fastQue.card,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.lg,
    padding: space[3],
    marginBottom: space[3],
    ...premiumShadow,
  },
  cardImage: { width: 84, height: 84, borderRadius: radius.md, marginRight: space[3] },
  cardBody: { flex: 1, justifyContent: 'center' },
  cardTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: fastQue.text },
  verifiedMark: { color: color.success, fontFamily: font.bodyBold },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: space[1] },
  cardMeta: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: fastQue.orange, marginTop: space[1] },
});
