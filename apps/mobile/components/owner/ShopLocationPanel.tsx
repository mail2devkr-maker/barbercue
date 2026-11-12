import { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import { DASHBOARD_PATHS, Language } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  decisionConsequence,
  formatCoordinates,
  formatReviewTime,
  mapLinkOut,
  parseLocation,
  proposalStatusLabel,
  round6,
  sourceLabel,
  validateCoordinates,
  type CoordinateErrors,
  type LocationView,
  type ProposalSource,
} from '../../lib/location-proposal';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';

/**
 * Website parity for apps/web/components/owner/ShopLocation.tsx: what customers see now, the last
 * reviewer decision, the owner's pending proposal, and a new proposal from the phone's location or
 * typed coordinates. A proposal is private and changes nothing public until a FastQue reviewer
 * approves it — the screen never says otherwise. Rules are the website's lib/location-proposal.ts.
 */
const GPS_TIMEOUT_MS = 15_000;

export function ShopLocationPanel({ salonId, language }: { salonId: string; language: Language }) {
  const hi = language === Language.HI;
  const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.location}`;
  const [view, setView] = useState<LocationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [source, setSource] = useState<ProposalSource>('MANUAL');
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [errors, setErrors] = useState<CoordinateErrors>({});
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const parsed = parseLocation(await apiFetch<unknown>(path));
      if (!parsed) setLoadError('FastQue sent an answer this screen could not read, so your location is not shown.');
      setView(parsed);
    } catch (err) {
      setView(null);
      setLoadError(err instanceof ApiError ? err.message : "Could not load your shop's location.");
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  const useDeviceLocation = async () => {
    setGeoError(null);
    setNotice(null);
    setLocating(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setGeoError(hi ? 'स्थान की अनुमति नहीं मिली। निर्देशांक हाथ से लिखें।' : 'Location permission was not given. Type the coordinates instead.');
        return;
      }
      // Bounded: a GPS fix that never arrives indoors must not leave the button spinning forever.
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS)),
      ]);
      if (!position) {
        setGeoError(hi ? 'स्थान समय पर नहीं मिला। खुले में फिर कोशिश करें या निर्देशांक लिखें।' : 'Your location could not be found in time. Try again outdoors, or type the coordinates.');
        return;
      }
      setLatText(String(round6(position.coords.latitude)));
      setLngText(String(round6(position.coords.longitude)));
      setAccuracy(Number.isFinite(position.coords.accuracy ?? NaN) ? Math.round(position.coords.accuracy as number) : null);
      setSource('GPS');
      setErrors({});
    } catch {
      setGeoError(hi ? 'इस फ़ोन से स्थान नहीं मिल सका। निर्देशांक लिखें।' : 'This phone could not share a location. Type the coordinates instead.');
    } finally {
      setLocating(false);
    }
  };

  const edited = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    // Numbers the owner typed or changed are "typed in", even if they started from the device location.
    setSource('MANUAL');
    setAccuracy(null);
    setNotice(null);
  };

  const submit = async () => {
    setNotice(null);
    setSubmitError(null);
    const { errors: found, value } = validateCoordinates(latText, lngText);
    setErrors(found);
    if (!value) return;
    setSubmitting(true);
    try {
      await apiFetch<unknown>(path, { method: 'PATCH', body: JSON.stringify({ latitude: value.latitude, longitude: value.longitude, source }) });
      setNotice(hi ? 'समीक्षा के लिए भेजा गया। FastQue की मंज़ूरी तक आपका सार्वजनिक स्थान नहीं बदलेगा।' : 'Sent for review. Your public location does not change until FastQue approves it.');
      await load();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not send the proposal. Nothing was changed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Text style={styles.muted}>…</Text>;
  const current = view?.current;
  const pending = view?.pending ?? null;
  const preview = validateCoordinates(latText, lngText).value;
  const openMap = (lat: number, lng: number) => void Linking.openURL(mapLinkOut(lat, lng));

  return (
    <View style={styles.wrap}>
      {!!loadError && <InlineError message={loadError} />}
      {view && current && (
        <Card>
          <Text style={styles.heading}>{hi ? 'ग्राहक अभी क्या देखते हैं' : 'What customers see now'}</Text>
          {current.latitude !== null && current.longitude !== null ? (
            <>
              <Text style={styles.strong}>{`${formatCoordinates(current.latitude, current.longitude)} · ${current.verified ? (hi ? 'सत्यापित' : 'Verified') : (hi ? 'अभी सत्यापित नहीं' : 'Not verified yet')}`}</Text>
              {current.verified && current.verifiedAt ? <Text style={styles.muted}>{`${hi ? 'सत्यापित' : 'Verified on'} ${formatReviewTime(current.verifiedAt)}`}</Text> : null}
              <Button title={hi ? 'नक्शे पर देखें' : 'Check on a map'} variant="outline" onPress={() => openMap(current.latitude as number, current.longitude as number)} />
            </>
          ) : <Text style={styles.muted}>{hi ? 'अभी कोई स्थान सेट नहीं। इसके बिना ग्राहक दूरी नहीं देख पाते।' : 'No location is set for your shop yet. Without one, customers cannot see how far you are.'}</Text>}
        </Card>
      )}
      {view?.lastDecision && (
        <Card>
          <Text style={styles.heading}>{hi ? 'पिछली समीक्षा' : 'Last review'}</Text>
          <Text style={styles.strong}>{`${proposalStatusLabel(view.lastDecision.status)}${view.lastDecision.reviewedAt ? ` · ${formatReviewTime(view.lastDecision.reviewedAt)}` : ''}`}</Text>
          <Text style={styles.muted}>{view.lastDecision.reviewNote ? `${hi ? 'समीक्षक का नोट' : 'Reviewer note'}: ${view.lastDecision.reviewNote}` : (hi ? 'समीक्षक ने नोट नहीं छोड़ा।' : 'The reviewer did not leave a note.')}</Text>
          <Text style={styles.muted}>{`${decisionConsequence(view.lastDecision)}${pending ? ' A newer proposal of yours is waiting for review.' : ''}`}</Text>
        </Card>
      )}
      {pending && (
        <Card>
          <Text style={styles.heading}>{hi ? 'आपका प्रस्ताव' : 'Your proposal'}</Text>
          <Text style={styles.strong}>{`${formatCoordinates(pending.latitude, pending.longitude)} · ${proposalStatusLabel(pending.status)}`}</Text>
          <Text style={styles.muted}>{`${sourceLabel(pending.source)} · ${hi ? 'भेजा' : 'sent'} ${formatReviewTime(pending.submittedAt)}`}</Text>
          <Button title={hi ? 'नक्शे पर देखें' : 'Check on a map'} variant="outline" onPress={() => openMap(pending.latitude, pending.longitude)} />
        </Card>
      )}
      <Card>
        <Text style={styles.heading}>{hi ? 'दुकान का स्थान प्रस्तावित करें' : "Propose your shop's location"}</Text>
        <Text style={styles.muted}>{hi ? 'दुकान पर खड़े होकर फ़ोन का स्थान उपयोग करें, या निर्देशांक लिखें। हर प्रस्ताव की समीक्षा होती है।' : 'Stand at your shop and use the phone location, or type the coordinates. FastQue reviews every proposal before customers see it.'}</Text>
        <Button title={locating ? (hi ? 'स्थान खोजा जा रहा है…' : 'Finding your location…') : (hi ? 'फ़ोन का स्थान उपयोग करें' : 'Use my phone location')} onPress={() => void useDeviceLocation()} disabled={locating || submitting} />
        {!!geoError && <Text style={styles.warn}>{geoError}</Text>}
        {source === 'GPS' && accuracy !== null && <Text style={styles.muted}>{hi ? `लगभग ${accuracy} मीटर तक सटीक। भेजने से पहले नक्शे पर जाँचें।` : `Phone location found, accurate to about ${accuracy} m. Check the point on a map before you send it.`}</Text>}
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>{hi ? 'अक्षांश' : 'Latitude'}</Text>
            <TextInput accessibilityLabel="Latitude" value={latText} onChangeText={edited(setLatText)} keyboardType="numbers-and-punctuation" style={styles.input} />
            {!!errors.latitude && <Text style={styles.warn}>{errors.latitude}</Text>}
          </View>
          <View style={styles.flex}>
            <Text style={styles.label}>{hi ? 'देशांतर' : 'Longitude'}</Text>
            <TextInput accessibilityLabel="Longitude" value={lngText} onChangeText={edited(setLngText)} keyboardType="numbers-and-punctuation" style={styles.input} />
            {!!errors.longitude && <Text style={styles.warn}>{errors.longitude}</Text>}
          </View>
        </View>
        {preview && <Button title={hi ? 'यह बिंदु नक्शे पर देखें' : 'Check this point on a map'} variant="outline" onPress={() => openMap(preview.latitude, preview.longitude)} />}
        {!!submitError && <InlineError message={submitError} />}
        {!!notice && <Text style={styles.ok}>{notice}</Text>}
        <Button title={submitting ? (hi ? 'भेजा जा रहा है…' : 'Sending…') : (hi ? 'समीक्षा के लिए भेजें' : 'Send for review')} onPress={() => void submit()} disabled={submitting || locating} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  strong: { fontFamily: font.bodySemiBold, color: color.ink, fontSize: fontSize.sm, marginVertical: space[1] },
  label: { fontFamily: font.bodyMedium, color: color.muted, fontSize: fontSize.xs, marginTop: space[2] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.xs, marginVertical: space[1] },
  warn: { fontFamily: font.bodyMedium, color: color.warn, fontSize: fontSize.xs, marginVertical: space[1] },
  ok: { fontFamily: font.bodyMedium, color: color.ink, fontSize: fontSize.sm, backgroundColor: color.successSoft, padding: space[3], borderRadius: radius.sm, marginVertical: space[2] },
  row: { flexDirection: 'row', gap: space[2] },
  flex: { flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: radius.sm, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[1] },
});
