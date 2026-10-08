import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  DISCOVERY_PATHS,
  PRICE_FILTER_PRESETS,
  SHOP_CLOSED_TODAY_MESSAGE,
  SALON_DISCOVERY_CATEGORIES,
  formatMoney,
  validatePriceRange,
  type PriceRangeValidationError,
  type PricePreset,
  type UiStrings,
} from '@barbercue/shared';
import type { PaginatedResult, SalonListItemDto, ServiceSuggestionDto } from '@barbercue/shared';
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
import { useLocationSelection } from '../lib/location/location-context';
import { distanceOrigin, fullLocationLabel, shopDistanceLabel, type SelectedLocation } from '../lib/location/selection';
import {
  buildSalonSearchParams,
  locationKey,
  mergePage,
  serverSuppliedDistances,
  sortLoadedByDistance,
  type SearchFilters,
  type SortChoice,
} from '../lib/location/search-params';
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
  const { initialQuery } = route.params ?? {};
  // The one shared location model. This screen never starts GPS itself any more: the customer picks
  // a city or taps "Use my current location" in the selector, and this screen simply reads the result.
  const { hydrated, selection, openSelector } = useLocationSelection();
  const origin = distanceOrigin(selection);
  const selectionKey = locationKey(selection);
  const [q, setQ] = useState(initialQuery ?? '');
  const [serviceSuggestions, setServiceSuggestions] = useState<ServiceSuggestionDto[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [results, setResults] = useState<SalonListItemDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  // Part 8/9 (distance + price + service filters) and the ordering.
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [priceMin, setPriceMin] = useState<number | null>(null);
  const [priceMax, setPriceMax] = useState<number | null>(null);
  const [service, setService] = useState<string | null>(null);
  const [sort, setSort] = useState<SortChoice>('nearest');

  // Every search takes a new sequence number; a response is applied only if it still matches, so a
  // slow answer for an old city can never replace the results for the city picked since.
  const requestSequence = useRef(0);
  // The exact request the visible list was loaded with, so "load more" continues THAT query even if
  // the customer has edited a filter or the text box since.
  const activeRequest = useRef<{ selection: SelectedLocation | null; filters: SearchFilters; queryText: string } | null>(null);

  const currentFilters = (overrides: Partial<SearchFilters> = {}): SearchFilters => ({
    radiusKm,
    priceMin,
    priceMax,
    service,
    sort,
    ...overrides,
  });

  async function runSearch(
    isRefresh: boolean,
    overrides: Partial<SearchFilters> & { queryText?: string; selection?: SelectedLocation | null } = {},
  ) {
    const { queryText: queryOverride, selection: selectionOverride, ...filterOverrides } = overrides;
    const request = {
      selection: selectionOverride === undefined ? selection : selectionOverride,
      filters: currentFilters(filterOverrides),
      queryText: queryOverride ?? q,
    };
    const sequence = ++requestSequence.current;
    activeRequest.current = request;
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    setLoadMoreFailed(false);
    setSearched(true);
    try {
      const params = buildSalonSearchParams(request);
      const result = await apiFetch<PaginatedResult<SalonListItemDto>>(`${DISCOVERY_PATHS.salons}?${params.toString()}`);
      if (sequence !== requestSequence.current) return;
      setResults(orderForDisplay(result.items, request));
      setNextCursor(result.nextCursor);
    } catch (err) {
      if (sequence !== requestSequence.current) return;
      setError(err instanceof ApiError ? err.message : t.couldNotSearchSalons);
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  // A server that predates the origin parameters ignores them and answers name-ordered with no
  // distances; fall back to ordering the loaded shops by the shared Haversine rather than showing
  // an unordered list under a "Nearest first" control.
  function orderForDisplay(items: SalonListItemDto[], request: { selection: SelectedLocation | null; filters: SearchFilters }) {
    const requestOrigin = distanceOrigin(request.selection);
    if (requestOrigin && request.filters.sort === 'nearest' && !serverSuppliedDistances(items)) {
      return sortLoadedByDistance(items, requestOrigin);
    }
    return items;
  }

  async function loadMore() {
    const request = activeRequest.current;
    if (!request || !nextCursor || loading || refreshing || loadingMore) return;
    const sequence = requestSequence.current;
    setLoadingMore(true);
    setLoadMoreFailed(false);
    try {
      const params = buildSalonSearchParams({ ...request, cursor: nextCursor });
      const result = await apiFetch<PaginatedResult<SalonListItemDto>>(`${DISCOVERY_PATHS.salons}?${params.toString()}`);
      if (sequence !== requestSequence.current) return;
      setResults((existing) => orderForDisplay(mergePage(existing, result.items), request));
      setNextCursor(result.nextCursor);
    } catch {
      if (sequence === requestSequence.current) setLoadMoreFailed(true);
    } finally {
      if (sequence === requestSequence.current) setLoadingMore(false);
    }
  }

  function handleSearch(isRefresh = false) {
    if (!isRefresh) setSuggestionsOpen(false);
    return runSearch(isRefresh);
  }

  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setServiceSuggestions([]);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<ServiceSuggestionDto[]>(
        `${DISCOVERY_PATHS.salons}/${DISCOVERY_PATHS.serviceSuggestions}?${new URLSearchParams({
          q: trimmed,
          limit: '250',
        }).toString()}`,
      )
        .then((items) => {
          if (!cancelled) setServiceSuggestions(items);
        })
        .catch(() => {
          if (!cancelled) setServiceSuggestions([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // Load shops for the chosen location as soon as there is one — and again whenever the customer
  // changes it (a different city, or switching to/from "current location"). Waits for the stored
  // selection to be read so a restart doesn't flash an empty search first. A radius only makes sense
  // against a reference point, so it is cleared if the new selection has none.
  useEffect(() => {
    if (!hydrated) return;
    const hasOrigin = origin !== null;
    if (!hasOrigin && radiusKm !== null) setRadiusKm(null);
    if (selection || initialQuery) {
      void runSearch(false, { selection, radiusKm: hasOrigin ? radiusKm : null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, selectionKey]);

  // Distance is relative to a reference point (a city centre or the customer's GPS fix), so with none
  // the customer is sent to choose one instead of a silent permission request.
  function selectRadius(value: number | null) {
    if (value !== null && !origin) {
      setError(t.distanceFilterNeedsLocation);
      if (!selection) openSelector();
      return;
    }
    setError(null);
    setRadiusKm(value);
    void runSearch(false, { radiusKm: value });
  }

  function selectPrice(min: number | null, max: number | null) {
    setPriceMin(min);
    setPriceMax(max);
    void runSearch(false, { priceMin: min, priceMax: max });
  }

  function selectService(value: string | null) {
    setService(value);
    void runSearch(false, { service: value });
  }

  function selectSort(value: SortChoice) {
    setSort(value);
    void runSearch(false, { sort: value });
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
  const locationBarLabel = selection ? fullLocationLabel(selection, t) : t.searchChooseLocationAction;

  return (
    <PremiumScreen scroll={false} contentStyle={styles.screenContent}>
      <PremiumSectionHeader eyebrow={t.discoveryEyebrow} title={t.findASalonSearchTitle} />
      {selectedStyleName && (
        <Text style={styles.styleNote}>
          {t.bookingForTheLookPrefix}<Text style={styles.styleNoteBold}>{selectedStyleName}</Text>{t.bookingForTheLookSuffix}
        </Text>
      )}

      {/* Same selector as Home: opening it never starts GPS. */}
      <Pressable
        testID="search-location-bar"
        onPress={openSelector}
        accessibilityRole="button"
        accessibilityLabel={`${t.locationSelectorTitle}: ${locationBarLabel}`}
        style={styles.locationBar}
      >
        <Text style={styles.locationBarPin}>📍</Text>
        <Text style={[styles.locationBarText, !selection && styles.locationBarPlaceholder]} numberOfLines={1}>
          {locationBarLabel}
        </Text>
        <Text style={styles.locationBarChange}>{selection ? t.searchChangeLocationAction : '›'}</Text>
      </Pressable>

      <View style={[styles.searchRow, stackSearchRow && styles.searchRowStacked]}>
        <PremiumTextField
          style={styles.input}
          placeholder={t.searchByNamePlaceholder}
          placeholderTextColor={fastQue.textMuted}
          value={q}
          onChangeText={(value) => {
            setQ(value);
            setSuggestionsOpen(true);
          }}
          onSubmitEditing={() => {
            setSuggestionsOpen(false);
            void handleSearch();
          }}
          returnKeyType="search"
        />
        <PremiumButton
          title={t.searchAction}
          onPress={() => void handleSearch()}
          loading={loading}
          style={[styles.searchButton, stackSearchRow && styles.searchButtonStacked]}
        />
      </View>

      {suggestionsOpen && q.trim().length >= 2 && serviceSuggestions.length > 0 && (
        <ScrollView
          style={styles.suggestionsBox}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          {serviceSuggestions.map((suggestion) => (
            <Pressable
              key={`${suggestion.name}-${suggestion.category ?? ''}`}
              style={styles.suggestionItem}
              onPress={() => {
                setQ(suggestion.name);
                setService(null);
                setSuggestionsOpen(false);
                void runSearch(false, { service: null, queryText: suggestion.name });
              }}
              accessibilityRole="button"
              accessibilityLabel={suggestion.name}
            >
              <Text style={styles.suggestionName}>{suggestion.name}</Text>
              {suggestion.category ? (
                <Text style={styles.suggestionCategory}>{suggestion.category}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Distance is always reachable. With no reference point yet, picking a radius sends the
          customer to the selector instead of silently asking for GPS permission. */}
      <View style={styles.filterRow}>
        <FilterDropdown
          label={t.distanceFilterLabel}
          valueLabel={distanceValueLabel}
          options={distanceOptions}
          selectedId={distanceIdFor(radiusKm)}
          onSelect={(id) => selectRadius(distanceValueFor(id))}
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
      {!origin && <Text style={styles.filterHint}>{t.distanceFilterNeedsLocation}</Text>}

      {origin && (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>{t.sortLabel}</Text>
          {(['nearest', 'name'] as const).map((choice) => (
            <Pressable
              key={choice}
              testID={`sort-${choice}`}
              onPress={() => selectSort(choice)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === choice }}
              style={[styles.sortChip, sort === choice && styles.sortChipActive]}
            >
              <Text style={[styles.sortChipText, sort === choice && styles.sortChipTextActive]}>
                {choice === 'nearest' ? t.sortNearestFirst : t.sortNameAZ}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {origin?.kind === 'city' && <Text style={styles.cityNote}>{t.distanceFromCityCentreNote}</Text>}

      {error && <InlineError message={error} />}

      {loading && !refreshing ? (
        <View style={styles.skeletonStack}>
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
          <Skeleton style={styles.skeletonCard} />
        </View>
      ) : !searched && !selection ? (
        <EmptyState
          title={t.searchChooseLocationTitle}
          message={t.searchChooseLocationHint}
          actionLabel={t.searchChooseLocationAction}
          onAction={openSelector}
        />
      ) : searched && !error && results.length === 0 ? (
        <EmptyState title={t.noSalonsFoundTitle} message={t.noSalonsFoundHint} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleSearch(true)} tintColor={color.accent} />}
          onEndReached={() => void loadMore()}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <Text style={styles.footerNote}>{t.searchLoadingMore}</Text>
            ) : loadMoreFailed ? (
              <Pressable onPress={() => void loadMore()} accessibilityRole="button">
                <Text style={styles.footerNote}>{t.searchLoadMoreFailed}</Text>
              </Pressable>
            ) : null
          }
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
                {item.isClosedForToday && (
                  <Text style={styles.closedToday}>{SHOP_CLOSED_TODAY_MESSAGE}</Text>
                )}
                {item.isOpenNow !== null && (
                  <Text style={styles.cardMeta}>{item.isOpenNow ? t.openNowLabel : t.closedNowLabel}</Text>
                )}
                {/* The wording follows the ORIGIN: "from <city> centre" for a chosen city, "from you"
                    for a real GPS fix, "Distance unavailable" when either end has no coordinates. */}
                {selection && (
                  <Text testID={`distance-${item.id}`} style={styles.cardDistance}>
                    📍 {shopDistanceLabel(item, origin, t)}
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
  locationBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: 48,
    paddingHorizontal: space[4],
    marginBottom: space[3],
    borderWidth: 1,
    borderColor: fastQue.borderStrong,
    borderRadius: radius.md,
    backgroundColor: fastQue.card,
  },
  locationBarPin: { fontSize: 16 },
  locationBarText: { flex: 1, minWidth: 0, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  locationBarPlaceholder: { color: fastQue.textSecondary },
  locationBarChange: { fontFamily: font.bodyBold, fontSize: fontSize.xs, color: fastQue.pink },
  sortRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginBottom: space[2] },
  sortLabel: { fontFamily: font.bodyBold, fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: fastQue.textMuted },
  sortChip: { paddingHorizontal: space[3], minHeight: 34, justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border },
  sortChipActive: { borderColor: fastQue.pink, backgroundColor: 'rgba(242,10,131,0.12)' },
  sortChipText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.textSecondary },
  sortChipTextActive: { color: fastQue.pink },
  cityNote: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginBottom: space[2] },
  cardDistance: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.orange, marginTop: space[1] },
  footerNote: { textAlign: 'center', fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, paddingVertical: space[4] },
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
  // Owner correction, round 2: the first fix dropped `flexGrow: 1` but forgot that `searchButton`'s
  // own `flexBasis: 110` (a WIDTH hint for row mode) is still merged in underneath this style and,
  // once searchRow is a column, `flexBasis` sizes the main (vertical) axis instead — so the button
  // rendered at a fixed 110px height even with flexGrow reset to 0. `flexBasis: 'auto'` here cancels
  // that inherited value so height comes from PremiumButton's own minHeight (52) instead; `width:
  // '100%'` is what makes it full-width in a column (flexBasis no longer does, on this axis).
  searchButtonStacked: { flexBasis: 'auto', flexGrow: 0, width: '100%' },
  suggestionsBox: {
    maxHeight: 280,
    marginTop: -space[3],
    marginBottom: space[3],
    backgroundColor: fastQue.card,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  suggestionItem: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: space[4],
    paddingVertical: space[2],
    borderBottomWidth: 1,
    borderBottomColor: fastQue.border,
  },
  suggestionName: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: fastQue.text },
  suggestionCategory: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: 2 },
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
  closedToday: {
    fontFamily: font.bodyBold,
    fontSize: fontSize.xs,
    color: '#7a2f12',
    backgroundColor: '#fff0e7',
    borderRadius: radius.sm,
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    marginTop: space[2],
  },
});
