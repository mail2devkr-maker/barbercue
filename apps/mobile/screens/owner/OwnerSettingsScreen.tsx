import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { DASHBOARD_PATHS, updateSalonProfileSchema, updateSalonTimezoneSchema, type SalonProfileDetailDto, type SalonTimezoneResultDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Button, Card, EmptyState, InlineError, Screen, SectionHeader, Skeleton } from '../../components/ui';

const salonPath = (salonId: string, resource: string) =>
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${resource}`;

type ProfileFields = Pick<SalonProfileDetailDto, 'name' | 'phone' | 'email' | 'addressLine' | 'postalCode' | 'description'>;
const emptyProfile: ProfileFields = { name: '', phone: '', email: '', addressLine: '', postalCode: '', description: '' };

function message(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

/** Native owner shop profile/timezone settings; both endpoints are owner-authorized and salon-scoped. */
export default function OwnerSettingsScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const copy = language === 'HI' ? {
    eyebrow: 'दुकान', title: 'दुकान की सेटिंग', subtitle: 'व्यवसाय की जानकारी और स्थानीय समय क्षेत्र बदलें।',
    selectShop: 'दुकान चुनें', chooseShop: 'सेटिंग बदलने से पहले दुकान चुनें।', retry: 'फिर कोशिश करें',
    business: 'व्यवसाय की जानकारी', name: 'दुकान का नाम', phone: 'फ़ोन', email: 'ईमेल', address: 'पता', postal: 'पिन कोड', description: 'विवरण',
    saveBusiness: 'व्यवसाय की जानकारी सहेजें', profileSaved: 'दुकान की जानकारी सहेजी गई।',
    timezone: 'दुकान का समय क्षेत्र', timezoneHelp: 'बुकिंग और एनालिटिक्स की सही स्थानीय तारीख़ों के लिए यह ज़रूरी है। सुझाया गया समय क्षेत्र आपकी पुष्टि के बिना सहेजा नहीं जाएगा।',
    suggested: 'सुझाव', confidence: 'विश्वसनीयता', useSuggested: 'सुझाया गया समय क्षेत्र चुनें', timezoneField: 'IANA समय क्षेत्र', timezonePlaceholder: 'जैसे Asia/Kolkata', saveTimezone: 'समय क्षेत्र सहेजें', timezoneSaved: 'दुकान का समय क्षेत्र सहेजा गया।',
    loadError: 'दुकान की सेटिंग लोड नहीं हो सकीं।', profileError: 'दुकान की जानकारी सहेजी नहीं जा सकी।', timezoneError: 'समय क्षेत्र सहेजा नहीं जा सका।', invalidProfile: 'जानकारी जाँचें और फिर कोशिश करें।', invalidTimezone: 'मान्य IANA समय क्षेत्र दर्ज करें।',
  } : {
    eyebrow: 'SHOP', title: 'Shop settings', subtitle: 'Edit business details and local time.',
    selectShop: 'Select a shop', chooseShop: 'Choose a shop before editing its settings.', retry: 'Retry',
    business: 'Business details', name: 'Shop name', phone: 'Phone', email: 'Email', address: 'Address', postal: 'Postal code', description: 'Description',
    saveBusiness: 'Save business details', profileSaved: 'Shop profile saved.',
    timezone: 'Shop time zone', timezoneHelp: 'Accurate shop-local booking and analytics dates depend on this setting. A detected suggestion is never saved until you confirm it.',
    suggested: 'Suggested', confidence: 'confidence', useSuggested: 'Use suggested time zone', timezoneField: 'IANA time zone', timezonePlaceholder: 'e.g. Asia/Kolkata', saveTimezone: 'Save time zone', timezoneSaved: 'Shop time zone saved.',
    loadError: 'Could not load shop settings.', profileError: 'Could not save shop details.', timezoneError: 'Could not save the shop time zone.', invalidProfile: 'Check the shop details and try again.', invalidTimezone: 'Enter a valid IANA time zone.',
  };
  const requestSeq = useRef(0);
  const [profile, setProfile] = useState<ProfileFields>(emptyProfile);
  const [timezone, setTimezone] = useState<SalonTimezoneResultDto | null>(null);
  const [timezoneDraft, setTimezoneDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedSalonId) { setLoading(false); return; }
    const requestId = ++requestSeq.current;
    setLoading(true);
    setError(null);
    setProfileError(null);
    setTimezoneError(null);
    setNotice(null);
    setProfile(emptyProfile);
    setTimezone(null);
    setTimezoneDraft('');
    try {
      const [profileResult, timezoneResult] = await Promise.all([
        apiFetch<SalonProfileDetailDto>(salonPath(selectedSalonId, DASHBOARD_PATHS.profile)),
        apiFetch<SalonTimezoneResultDto>(salonPath(selectedSalonId, DASHBOARD_PATHS.timezone)),
      ]);
      if (requestId !== requestSeq.current) return;
      setProfile({
        name: profileResult.name,
        phone: profileResult.phone ?? '',
        email: profileResult.email ?? '',
        addressLine: profileResult.addressLine,
        postalCode: profileResult.postalCode ?? '',
        description: profileResult.description ?? '',
      });
      setTimezone(timezoneResult);
      setTimezoneDraft(timezoneResult.timezone ?? '');
    } catch (err) {
      if (requestId === requestSeq.current) setError(message(err, copy.loadError));
    } finally {
      if (requestId === requestSeq.current) setLoading(false);
    }
  }, [selectedSalonId]);

  useEffect(() => {
    void load();
    return () => { requestSeq.current += 1; };
  }, [load]);

  const saveProfile = async () => {
    if (!selectedSalonId) return;
    const parsed = updateSalonProfileSchema.safeParse(profile);
    if (!parsed.success) {
      setProfileError(copy.invalidProfile);
      return;
    }
    const requestId = requestSeq.current;
    setSavingProfile(true);
    setProfileError(null);
    setNotice(null);
    try {
      const result = await apiFetch<SalonProfileDetailDto>(salonPath(selectedSalonId, DASHBOARD_PATHS.profile), {
        method: 'PATCH', body: JSON.stringify(parsed.data),
      });
      if (requestId !== requestSeq.current) return;
      setProfile({ name: result.name, phone: result.phone ?? '', email: result.email ?? '', addressLine: result.addressLine, postalCode: result.postalCode ?? '', description: result.description ?? '' });
      setNotice(copy.profileSaved);
    } catch (err) {
      if (requestId === requestSeq.current) setProfileError(message(err, copy.profileError));
    } finally {
      if (requestId === requestSeq.current) setSavingProfile(false);
    }
  };

  const saveTimezone = async () => {
    if (!selectedSalonId) return;
    const parsed = updateSalonTimezoneSchema.safeParse({ timezone: timezoneDraft });
    if (!parsed.success) {
      setTimezoneError(copy.invalidTimezone);
      return;
    }
    const requestId = requestSeq.current;
    setSavingTimezone(true);
    setTimezoneError(null);
    setNotice(null);
    try {
      const result = await apiFetch<SalonTimezoneResultDto>(salonPath(selectedSalonId, DASHBOARD_PATHS.timezone), {
        method: 'PATCH', body: JSON.stringify(parsed.data),
      });
      if (requestId !== requestSeq.current) return;
      setTimezone(result);
      setTimezoneDraft(result.timezone ?? parsed.data.timezone);
      setNotice(copy.timezoneSaved);
    } catch (err) {
      if (requestId === requestSeq.current) setTimezoneError(message(err, copy.timezoneError));
    } finally {
      if (requestId === requestSeq.current) setSavingTimezone(false);
    }
  };

  if (!selectedSalonId) return <Screen scroll={false}><EmptyState title={copy.selectShop} message={copy.chooseShop} /></Screen>;
  if (loading) return <Screen><Skeleton style={styles.skeleton} /><Skeleton style={styles.skeleton} /></Screen>;
  if (error) return <Screen scroll={false}><InlineError message={error} /><Button title={copy.retry} variant="outline" onPress={() => void load()} /></Screen>;

  return (
    <Screen>
      <SectionHeader eyebrow={copy.eyebrow} title={copy.title} subtitle={selectedSalon?.name ?? copy.subtitle} />
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Card style={styles.card}>
        <Text style={styles.heading}>{copy.business}</Text>
        <Field label={copy.name} value={profile.name} onChangeText={(name) => setProfile((current) => ({ ...current, name }))} />
        <Field label={copy.phone} value={profile.phone ?? ''} keyboardType="phone-pad" onChangeText={(phone) => setProfile((current) => ({ ...current, phone }))} />
        <Field label={copy.email} value={profile.email ?? ''} keyboardType="email-address" autoCapitalize="none" onChangeText={(email) => setProfile((current) => ({ ...current, email }))} />
        <Field label={copy.address} value={profile.addressLine} onChangeText={(addressLine) => setProfile((current) => ({ ...current, addressLine }))} />
        <Field label={copy.postal} value={profile.postalCode ?? ''} onChangeText={(postalCode) => setProfile((current) => ({ ...current, postalCode }))} />
        <Field label={copy.description} value={profile.description ?? ''} multiline onChangeText={(description) => setProfile((current) => ({ ...current, description }))} />
        {profileError ? <Text accessibilityRole="alert" style={styles.error}>{profileError}</Text> : null}
        <Button title={copy.saveBusiness} onPress={() => void saveProfile()} loading={savingProfile} />
      </Card>
      <Card style={styles.card}>
        <Text style={styles.heading}>{copy.timezone}</Text>
        <Text style={styles.help}>{copy.timezoneHelp}</Text>
        {timezone?.suggestion ? (
          <View style={styles.suggestion}>
            <Text style={styles.help}>{copy.suggested}: {timezone.suggestion.timezone} ({copy.confidence})</Text>
            <Button title={copy.useSuggested} variant="outline" onPress={() => { setTimezoneDraft(timezone.suggestion!.timezone); setTimezoneError(null); }} />
          </View>
        ) : null}
        <Field label={copy.timezoneField} value={timezoneDraft} autoCapitalize="none" placeholder={copy.timezonePlaceholder} onChangeText={setTimezoneDraft} />
        {timezoneError ? <Text accessibilityRole="alert" style={styles.error}>{timezoneError}</Text> : null}
        <Button title={copy.saveTimezone} onPress={() => void saveTimezone()} loading={savingTimezone} />
      </Card>
    </Screen>
  );
}

function Field(props: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'default' | 'email-address' | 'phone-pad'; autoCapitalize?: 'none' | 'sentences'; multiline?: boolean; placeholder?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        style={[styles.input, props.multiline && styles.multiline]}
        value={props.value}
        onChangeText={props.onChangeText}
        keyboardType={props.keyboardType ?? 'default'}
        autoCapitalize={props.autoCapitalize ?? 'sentences'}
        multiline={props.multiline}
        placeholder={props.placeholder}
        placeholderTextColor={color.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: space[4] },
  heading: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.lg, marginBottom: space[3] },
  field: { marginBottom: space[3] },
  label: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.sm, marginBottom: space[1] },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, color: color.ink, paddingHorizontal: space[3], paddingVertical: space[2], backgroundColor: '#fff' },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  help: { color: color.muted, fontSize: fontSize.sm, lineHeight: 21, marginBottom: space[3] },
  suggestion: { gap: space[2], marginBottom: space[3] },
  error: { color: '#a11b3a', marginBottom: space[3] },
  notice: { color: '#176b46', marginBottom: space[3] },
  skeleton: { height: 280, borderRadius: radius.lg, marginBottom: space[3] },
});
