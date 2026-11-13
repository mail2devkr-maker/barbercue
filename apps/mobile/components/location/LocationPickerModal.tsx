import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DISCOVERY_PATHS, type CityDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { resolveHomeLocation } from '../../lib/home-location';
import { filterCities, setLocationChoice, type LocationChoice } from '../../lib/location-choice';
import { font, fastQue } from '../../lib/theme';

let cachedCities: CityDto[] | null = null;

/**
 * Website parity for the search page's "City / location" picker: choose one of the cities FastQue
 * has shops in (GET cities — the same list the website loads), all cities, or the phone's current
 * location. Current location is what makes "x km away" distances possible, exactly like the website.
 */
export function LocationPickerModal({
  visible,
  onClose,
  onChosen,
  hindi,
}: {
  visible: boolean;
  onClose: () => void;
  onChosen?: (choice: LocationChoice | null) => void;
  hindi: boolean;
}) {
  const [cities, setCities] = useState<CityDto[] | null>(cachedCities);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('');
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFilter('');
    setGpsError(null);
    if (cachedCities) return;
    let cancelled = false;
    setLoadError(false);
    apiFetch<CityDto[]>(DISCOVERY_PATHS.cities)
      .then((list) => {
        if (cancelled) return;
        cachedCities = Array.isArray(list) ? list : [];
        setCities(cachedCities);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [visible]);

  const shown = useMemo(() => filterCities(cities ?? [], filter), [cities, filter]);

  function choose(choice: LocationChoice | null) {
    setLocationChoice(choice);
    onChosen?.(choice);
    onClose();
  }

  async function useCurrentLocation() {
    setLocating(true);
    setGpsError(null);
    try {
      const result = await resolveHomeLocation(true, true);
      if (!result) {
        setGpsError(hindi ? 'लोकेशन नहीं मिली। अनुमति दें या नीचे से शहर चुनें।' : 'Could not get your location. Allow location access, or pick a city below.');
        return;
      }
      choose({ kind: 'gps', label: result.label, coords: result.coords });
    } finally {
      setLocating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{hindi ? 'शहर / लोकेशन चुनें' : 'Choose city / location'}</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={hindi ? 'बंद करें' : 'Close'} hitSlop={12}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>
          <Pressable
            style={styles.gpsRow}
            onPress={() => void useCurrentLocation()}
            disabled={locating}
            accessibilityRole="button"
            accessibilityLabel={hindi ? 'मेरी मौजूदा लोकेशन इस्तेमाल करें' : 'Use my current location'}
          >
            {locating ? <ActivityIndicator color={fastQue.coral} /> : <Text style={styles.gpsIcon}>◎</Text>}
            <View style={styles.flex}>
              <Text style={styles.gpsText}>{hindi ? 'मेरी मौजूदा लोकेशन इस्तेमाल करें' : 'Use my current location'}</Text>
              <Text style={styles.sub}>{hindi ? 'पास की दुकानें और उनकी दूरी दिखाता है' : 'Shows nearby shops and how far away they are'}</Text>
            </View>
          </Pressable>
          {gpsError ? <Text style={styles.error} accessibilityRole="alert">{gpsError}</Text> : null}
          <TextInput
            style={styles.input}
            value={filter}
            onChangeText={setFilter}
            placeholder={hindi ? 'शहर खोजें' : 'Search cities'}
            placeholderTextColor={fastQue.textMuted}
            accessibilityLabel={hindi ? 'शहर खोजें' : 'Search cities'}
            autoCorrect={false}
          />
          {loadError ? (
            <Text style={styles.error} accessibilityRole="alert">{hindi ? 'शहरों की सूची लोड नहीं हो सकी।' : 'Could not load the list of cities.'}</Text>
          ) : !cities ? (
            <ActivityIndicator color={fastQue.coral} style={styles.loading} />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(c) => c.id}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListHeaderComponent={filter ? null : (
                <Pressable style={styles.cityRow} onPress={() => choose(null)} accessibilityRole="button" accessibilityLabel={hindi ? 'सभी शहर' : 'All cities'}>
                  <Text style={styles.cityName}>{hindi ? 'सभी शहर' : 'All cities'}</Text>
                </Pressable>
              )}
              ListEmptyComponent={<Text style={styles.sub}>{hindi ? 'कोई शहर नहीं मिला।' : 'No matching city.'}</Text>}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.cityRow}
                  onPress={() => choose({ kind: 'city', city: { id: item.id, name: item.name, slug: item.slug, countryCode: item.countryCode, state: item.state } })}
                  accessibilityRole="button"
                  accessibilityLabel={item.state ? `${item.name}, ${item.state}` : item.name}
                >
                  <Text style={styles.cityName}>{item.name}</Text>
                  {item.state ? <Text style={styles.sub}>{item.state}</Text> : null}
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

export function __resetCityCacheForTests(): void {
  cachedCities = null;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', backgroundColor: fastQue.backgroundRaised, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, gap: 10, borderColor: fastQue.border, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: font.bodyBold, color: fastQue.text, fontSize: 17 },
  close: { color: fastQue.textSecondary, fontSize: 18 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: fastQue.borderStrong, backgroundColor: fastQue.card },
  gpsIcon: { color: fastQue.coral, fontSize: 20 },
  gpsText: { fontFamily: font.bodySemiBold, color: fastQue.text, fontSize: 15 },
  flex: { flex: 1 },
  sub: { fontFamily: font.bodyRegular, color: fastQue.textMuted, fontSize: 12, marginTop: 2 },
  error: { fontFamily: font.bodyRegular, color: fastQue.error, fontSize: 13 },
  input: { minHeight: 44, borderWidth: 1, borderColor: fastQue.border, borderRadius: 10, paddingHorizontal: 12, color: fastQue.text, backgroundColor: fastQue.input, fontFamily: font.bodyRegular },
  loading: { marginVertical: 24 },
  list: { flexGrow: 0 },
  cityRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: fastQue.border },
  cityName: { fontFamily: font.bodySemiBold, color: fastQue.text, fontSize: 15 },
});
