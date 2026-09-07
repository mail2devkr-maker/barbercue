import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import {
  COUNTRY_PATHS,
  DISCOVERY_PATHS,
  isValidPostalCode,
  orderCountriesForDisplay,
  phonePlaceholderForCountry,
  postalCodeRuleFor,
  registerSalonSchema,
} from '@barbercue/shared';
import type { CitySearchResultDto, CountryDto, LocalityDto, RegisterSalonResponseDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, InlineError } from '../components/ui';

const SEARCH_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const RESULT_LIMIT = 8;

interface FormState {
  countryCode: string;
  name: string;
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
  localitySlug: string;
}

const EMPTY: FormState = {
  countryCode: '',
  name: '',
  phone: '',
  email: '',
  addressLine: '',
  postalCode: '',
  localitySlug: '',
};

function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

type LocationState =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'detected'; lat: number; lng: number }
  | { kind: 'failed' };

type CitySearchState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'results'; cities: CitySearchResultDto[] } | { kind: 'failed' };

/**
 * Mobile shop registration (Mobile Shop Owner Onboarding mission) — reuses the exact same
 * registerSalonSchema and POST /salons contract as apps/web's RegisterSalonForm, not a second
 * mobile-only endpoint or rule set. Country/city/locality pickers are custom (React Native has no
 * <select>), but the data they gather and the payload they send are identical to web's.
 *
 * On success, applies the freshly-minted STAFF-audience session (see RegisterSalonResponseDto's
 * doc comment on why this is a new session, never an in-place upgrade of whatever session opened
 * this screen). No further navigation call is made here: App.tsx's AuthenticatedNavigator swaps to
 * OwnerNavigator the instant the applied session's roles include SALON_OWNER, and OwnerNavigator
 * itself detects the new PENDING salon and opens the onboarding wizard — the same mechanism that
 * lets `onRegistered` stay optional (only OwnerNavigator's own ownerless-account embedding needs
 * it, to refresh its already-mounted SalonProvider; see OwnerNavigator.tsx).
 */
export default function RegisterShopScreen({ onRegistered }: { onRegistered?: () => void }) {
  const { applySession } = useAuth();
  const { t } = useLanguage();
  const [countries, setCountries] = useState<CountryDto[]>([]);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [selectedCity, setSelectedCity] = useState<CitySearchResultDto | null>(null);
  const [cityQuery, setCityQuery] = useState('');
  const [cityState, setCityState] = useState<CitySearchState>({ kind: 'idle' });
  const [localities, setLocalities] = useState<LocalityDto[]>([]);
  const [localityPickerOpen, setLocalityPickerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<LocationState>({ kind: 'idle' });
  const citySearchSeqRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<CountryDto[]>(COUNTRY_PATHS.countries)
      .then((list) => {
        if (!cancelled) setCountries(orderCountriesForDisplay(list));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = cityQuery.trim();
    if (!form.countryCode || selectedCity || trimmed.length < MIN_QUERY_LENGTH) {
      setCityState({ kind: 'idle' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const seq = (citySearchSeqRef.current += 1);
      setCityState({ kind: 'loading' });
      const country = countries.find((c) => c.isoCode2 === form.countryCode);
      if (!country) return;
      const params = new URLSearchParams({ countryId: country.id, q: trimmed, limit: String(RESULT_LIMIT) });
      apiFetch<CitySearchResultDto[]>(`${DISCOVERY_PATHS.cities}/${DISCOVERY_PATHS.citySearch}?${params.toString()}`)
        .then((cities) => {
          if (cancelled || seq !== citySearchSeqRef.current) return;
          setCityState({ kind: 'results', cities });
        })
        .catch(() => {
          if (cancelled || seq !== citySearchSeqRef.current) return;
          setCityState({ kind: 'failed' });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cityQuery, form.countryCode, selectedCity, countries]);

  useEffect(() => {
    if (!selectedCity) {
      setLocalities([]);
      return;
    }
    let cancelled = false;
    apiFetch<LocalityDto[]>(`${DISCOVERY_PATHS.cities}/${form.countryCode}/${selectedCity.slug}/localities`)
      .then((list) => {
        if (!cancelled) setLocalities(list);
      })
      .catch(() => {
        if (!cancelled) setLocalities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCity, form.countryCode]);

  const postalRule = postalCodeRuleFor(form.countryCode);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function selectCountry(country: CountryDto) {
    setForm((prev) => ({ ...prev, countryCode: country.isoCode2, localitySlug: '' }));
    setSelectedCity(null);
    setCityQuery('');
    setLocalities([]);
    setCountryPickerOpen(false);
  }

  function chooseCity(city: CitySearchResultDto) {
    setSelectedCity(city);
    setCityQuery('');
    setCityState({ kind: 'idle' });
    setForm((prev) => ({ ...prev, localitySlug: '' }));
  }

  function clearCity() {
    setSelectedCity(null);
    setLocalities([]);
    setForm((prev) => ({ ...prev, localitySlug: '' }));
  }

  async function detectLocation() {
    setError(null);
    setLocation({ kind: 'detecting' });
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        // GPS permission denial must never block registration — the form remains fully usable
        // with just address + city + postal code, which is what actually identifies the shop.
        setLocation({ kind: 'failed' });
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation({ kind: 'detected', lat: round5(position.coords.latitude), lng: round5(position.coords.longitude) });
    } catch {
      setLocation({ kind: 'failed' });
    }
  }

  async function handleSubmit() {
    setError(null);

    if (!form.countryCode) {
      setError(t.chooseCountryFirstError);
      return;
    }
    if (!selectedCity) {
      setError(t.chooseCityFirstError);
      return;
    }
    if (!isValidPostalCode(form.countryCode, form.postalCode)) {
      setError(
        postalRule.example
          ? `${t.registerShopTitle}: ${postalRule.label} (${postalRule.example})`
          : postalRule.label,
      );
      return;
    }

    const parsed = registerSalonSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone.trim() || undefined,
      email: form.email.trim() || undefined,
      addressLine: form.addressLine.trim(),
      countryCode: form.countryCode,
      postalCode: form.postalCode.trim() || undefined,
      citySlug: selectedCity.slug,
      localitySlug: form.localitySlug || undefined,
      ...(location.kind === 'detected' ? { lat: location.lat, lng: location.lng } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.couldNotRegisterShop);
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<RegisterSalonResponseDto>(DISCOVERY_PATHS.salons, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(parsed.data),
      });
      await applySession(result);
      onRegistered?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotRegisterShop);
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCountry = countries.find((c) => c.isoCode2 === form.countryCode) ?? null;
  const cities = cityState.kind === 'results' ? cityState.cities : [];

  return (
    <Screen contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.roleOwner} title={t.registerShopTitle} subtitle={t.registerShopSubtitle} />

      {error && <InlineError message={error} />}

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopNameLabel}</Text>
        <TextInput
          style={styles.input}
          value={form.name}
          onChangeText={(v) => update('name', v)}
          placeholder={t.shopNamePlaceholder}
          placeholderTextColor={color.muted}
          maxLength={200}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopCountryLabel}</Text>
        <Pressable style={styles.input} onPress={() => setCountryPickerOpen(true)}>
          <Text style={selectedCountry ? styles.pickerValueText : styles.pickerPlaceholderText}>
            {selectedCountry ? selectedCountry.name : countries.length === 0 ? t.loadingCountriesHint : t.selectCountryPlaceholder}
          </Text>
        </Pressable>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopCityLabel}</Text>
        {selectedCity ? (
          <View style={styles.selectedCityRow}>
            <Text style={styles.pickerValueText} numberOfLines={1}>
              {selectedCity.name}
              {selectedCity.region ? `, ${selectedCity.region.name}` : ''}
            </Text>
            <Pressable onPress={clearCity}>
              <Text style={styles.changeCityText}>{t.changeCityAction}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={cityQuery}
              onChangeText={setCityQuery}
              placeholder={t.citySearchPlaceholder}
              placeholderTextColor={color.muted}
              editable={Boolean(form.countryCode)}
            />
            {cityState.kind === 'loading' && <ActivityIndicator color={color.muted} style={styles.citySearchSpinner} />}
            {cityQuery.trim().length > 0 && cityQuery.trim().length < MIN_QUERY_LENGTH && (
              <Text style={styles.hint}>{t.citySearchTooShortHint}</Text>
            )}
            {cityState.kind === 'failed' && <Text style={styles.hint}>{t.citySearchFailedHint}</Text>}
            {cityState.kind === 'results' && cities.length === 0 && <Text style={styles.hint}>{t.citySearchNoResults}</Text>}
            {cities.length > 0 && (
              <View style={styles.cityResultList}>
                {cities.map((city) => (
                  <Pressable key={city.id} style={styles.cityResultRow} onPress={() => chooseCity(city)}>
                    <Text style={styles.pickerValueText}>
                      {city.name}
                      {city.region ? `, ${city.region.name}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </View>

      {selectedCity && localities.length > 0 && (
        <View style={styles.field}>
          <Text style={styles.label}>{t.shopLocalityLabel}</Text>
          <Pressable style={styles.input} onPress={() => setLocalityPickerOpen(true)}>
            <Text style={form.localitySlug ? styles.pickerValueText : styles.pickerPlaceholderText}>
              {form.localitySlug ? localities.find((l) => l.slug === form.localitySlug)?.name : t.noLocalityOption}
            </Text>
          </Pressable>
          <Text style={styles.hint}>{t.shopLocalityOptionalHint}</Text>
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopAddressLabel}</Text>
        <TextInput
          style={styles.input}
          value={form.addressLine}
          onChangeText={(v) => update('addressLine', v)}
          placeholder={t.shopAddressPlaceholder}
          placeholderTextColor={color.muted}
          maxLength={300}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          {postalRule.label}
          {postalRule.required ? '' : t.shopPostalCodeOptionalSuffix}
        </Text>
        <TextInput
          style={[styles.input, styles.postalInput]}
          value={form.postalCode}
          onChangeText={(v) => update('postalCode', v)}
          placeholder={postalRule.example}
          placeholderTextColor={color.muted}
          keyboardType={postalRule.regex.source.includes('[A-Za-z]') ? 'default' : 'numeric'}
          maxLength={12}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopPhoneLabel}</Text>
        <TextInput
          style={styles.input}
          value={form.phone}
          onChangeText={(v) => update('phone', v)}
          placeholder={phonePlaceholderForCountry(form.countryCode)}
          placeholderTextColor={color.muted}
          keyboardType="phone-pad"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>{t.shopEmailLabel}</Text>
        <TextInput
          style={styles.input}
          value={form.email}
          onChangeText={(v) => update('email', v)}
          placeholderTextColor={color.muted}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      <View style={styles.field}>
        <Button
          title={
            location.kind === 'detecting'
              ? t.detectingLocationEllipsis
              : location.kind === 'detected'
                ? t.locationDetectedLabel
                : t.useCurrentLocationAction
          }
          variant="outline"
          onPress={() => void detectLocation()}
          loading={location.kind === 'detecting'}
          disabled={location.kind === 'detected'}
        />
        {location.kind === 'failed' && <Text style={styles.hint}>{t.locationSkippedHint}</Text>}
      </View>

      <Button
        title={submitting ? t.registeringShopEllipsis : t.registerShopAction}
        onPress={() => void handleSubmit()}
        loading={submitting}
        disabled={!form.name.trim() || !form.addressLine.trim()}
        style={styles.submitButton}
      />

      <Modal visible={countryPickerOpen} animationType="slide" onRequestClose={() => setCountryPickerOpen(false)}>
        <Screen scroll={false} contentStyle={styles.pickerScreen}>
          <SectionHeader eyebrow={t.registerShopTitle} title={t.shopCountryLabel} />
          <FlatList
            data={countries}
            keyExtractor={(c) => c.id}
            renderItem={({ item }) => (
              <Pressable style={styles.pickerRow} onPress={() => selectCountry(item)}>
                <Text style={styles.pickerValueText}>{item.name}</Text>
              </Pressable>
            )}
          />
          <Button title={t.cancelAction} variant="outline" onPress={() => setCountryPickerOpen(false)} style={styles.pickerCloseButton} />
        </Screen>
      </Modal>

      <Modal visible={localityPickerOpen} animationType="slide" onRequestClose={() => setLocalityPickerOpen(false)}>
        <Screen scroll={false} contentStyle={styles.pickerScreen}>
          <SectionHeader eyebrow={t.registerShopTitle} title={t.shopLocalityLabel} />
          <FlatList
            data={[{ id: '', name: t.noLocalityOption, slug: '', citySlug: '' }, ...localities]}
            keyExtractor={(l) => l.id || 'none'}
            renderItem={({ item }) => (
              <Pressable
                style={styles.pickerRow}
                onPress={() => {
                  update('localitySlug', item.slug);
                  setLocalityPickerOpen(false);
                }}
              >
                <Text style={styles.pickerValueText}>{item.name}</Text>
              </Pressable>
            )}
          />
          <Button title={t.cancelAction} variant="outline" onPress={() => setLocalityPickerOpen(false)} style={styles.pickerCloseButton} />
        </Screen>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  field: { marginBottom: space[4] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, marginBottom: space[2] },
  input: {
    minHeight: 50,
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    color: color.ink,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[4],
    fontSize: fontSize.base,
  },
  postalInput: { letterSpacing: 0.06 },
  pickerValueText: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: color.ink },
  pickerPlaceholderText: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: color.muted },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[2] },
  selectedCityRow: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.goldSoft,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    gap: space[2],
  },
  changeCityText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.accent },
  citySearchSpinner: { marginTop: space[2] },
  cityResultList: {
    marginTop: space[2],
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  cityResultRow: { minHeight: 46, justifyContent: 'center', paddingHorizontal: space[4], borderBottomWidth: 1, borderBottomColor: color.border },
  submitButton: { marginTop: space[2] },
  pickerScreen: { padding: space[5], flex: 1 },
  pickerRow: { minHeight: 50, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: color.border },
  pickerCloseButton: { marginTop: space[3] },
});
