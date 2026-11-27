import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import {
  DISCOVERY_PATHS,
  EMPLOYEE_PATHS,
  ONBOARDING_AMENITIES,
  ONBOARDING_AMENITY_LABEL,
  ONBOARDING_CONSENT_METHOD_LABEL,
  ONBOARDING_FIELD_LABELS,
  ONBOARDING_GPS_GOOD_ACCURACY_METERS,
  ONBOARDING_MEDIA_LIMITS,
  ONBOARDING_PHOTO_SLOTS,
  ONBOARDING_SALON_KIND_LABEL,
  ONBOARDING_SHOP_PHOTO_CATEGORIES,
  ONBOARDING_STATUS_LABELS,
  onboardingIssueMessages,
  salonKindsText,
  type MenuExtractionResultDto,
  type OnboardingApplicationDto,
  type OnboardingHoursDto,
  type OnboardingMediaCategory,
  type OnboardingMediaDto,
  type PincodeLookupDto,
} from '@barbercue/shared';
import { ApiError, NativeUploadError, apiFetch, apiUploadImage, getAccessToken, getApiBaseUrl } from '../../lib/api';
import { IMAGE_UPLOAD_PREPARATION_MESSAGE, ImageUploadPreparationError, uploadImageAsset } from '../../lib/image-upload';
import {
  EMPLOYEE_ONBOARDING,
  LAT_LNG_PAIR,
  ONBOARDING_STEPS,
  WEEK_DAYS,
  addressPreview,
  draftPayload,
  formFromApplication,
  formatInr,
  hoursForSave,
  initialHours,
  listHas,
  liveMissing,
  newServiceRow,
  parseManualPin,
  rowsFromServices,
  servicesPayload,
  toggleListValue,
  type DraftForm,
  type ServiceRow,
} from '../../lib/onboarding';
import { canPickServiceSheet, pickServiceSheet, shareServiceSheetTemplate } from '../../lib/service-sheet-picker';
import { PremiumButton, PremiumCard, PremiumScreen, PremiumTextField } from '../../components/ui';
import { font, fontSize, radius, space } from '../../lib/theme';
import { useThemedStyles, useThemeTokens, type ThemeTokens } from '../../lib/theme-mode';
import type { EmployeeStackParamList } from '../../navigation/EmployeeNavigator';

function message(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const issues = onboardingIssueMessages(error.details);
  return issues.length ? `Please correct: ${issues.join('; ')}` : error.message;
}

function uploadMessage(error: unknown, fallback: string): string {
  if (error instanceof ImageUploadPreparationError) return IMAGE_UPLOAD_PREPARATION_MESSAGE;
  if (error instanceof NativeUploadError) return error.message;
  return message(error, fallback);
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** "930" / "9:30" / "21.30" -> "09:30" / "21:30"; anything else is kept as typed so the user can finish. */
function normaliseTime(raw: string): string {
  const v = raw.trim().replace('.', ':');
  const m = v.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return v;
  const t = `${m[1].padStart(2, '0')}:${m[2]}`;
  return TIME.test(t) ? t : v;
}

type Props = NativeStackScreenProps<EmployeeStackParamList, 'EmployeeOnboardingWizard'>;

/**
 * The 8-step field onboarding form, mobile copy of apps/web/components/onboarding/OnboardingWizard.tsx.
 * Everything typed is kept in memory and saved on "Save draft" and on every step change. The
 * server repeats every validation; this screen only makes problems visible early.
 */
export default function EmployeeOnboardingWizardScreen({ route, navigation }: Props) {
  const { applicationId } = route.params;
  const styles = useThemedStyles(makeStyles);
  const [app, setApp] = useState<OnboardingApplicationDto | null>(null);
  const [form, setForm] = useState<DraftForm>({});
  const [hours, setHours] = useState<OnboardingHoursDto[]>(initialHours([]));
  const [rows, setRows] = useState<ServiceRow[]>([]);
  const [pinLat, setPinLat] = useState('');
  const [pinLng, setPinLng] = useState('');
  const [step, setStep] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [servicesDirty, setServicesDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pinNote, setPinNote] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView | null>(null);
  const sheetImport = useMemo(() => canPickServiceSheet(), []);

  const accept = useCallback((next: OnboardingApplicationDto, resetLocal: boolean) => {
    setApp(next);
    if (resetLocal) {
      setForm(formFromApplication(next));
      setHours(initialHours(next.hours));
      setRows(rowsFromServices(next.services));
      setDirty(false);
      setServicesDirty(false);
    }
  }, []);

  useEffect(() => {
    apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${applicationId}`)
      .then((next) => {
        accept(next, true);
        navigation.setOptions({ title: next.salonName });
      })
      .catch((err) => setError(message(err, 'Could not load this application.')));
  }, [accept, applicationId, navigation]);

  const readOnly = !app?.canEdit;
  const set = (key: string, value: string | number | boolean | null) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = useCallback(async (quiet = false): Promise<boolean> => {
    if (!app || readOnly) return true;
    if (!dirty && !servicesDirty) return true;
    setBusy('save');
    setError(null);
    try {
      let next = app;
      if (dirty) {
        next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ ...draftPayload(form), hours: hoursForSave(hours), expectedVersion: next.version }),
        });
      }
      if (servicesDirty) {
        next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}/${EMPLOYEE_PATHS.services}`, {
          method: 'PUT',
          body: JSON.stringify({ services: servicesPayload(rows), expectedVersion: next.version }),
        });
      }
      accept(next, false);
      setRows(rowsFromServices(next.services));
      setDirty(false);
      setServicesDirty(false);
      if (!quiet) setNotice('Draft saved.');
      return true;
    } catch (err) {
      setError(message(err, 'Could not save. Your changes are still here; try again.'));
      return false;
    } finally {
      setBusy(null);
    }
  }, [accept, app, dirty, form, hours, readOnly, rows, servicesDirty]);

  const goTo = async (next: number) => {
    setNotice(null);
    if (await save(true)) {
      setStep(next);
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    }
  };

  const missing = useMemo(
    () => (app ? liveMissing(form, hours, rows, app.media, app.photoExceptionReason) : []),
    [app, form, hours, rows],
  );

  if (error && !app) return <PremiumScreen contentStyle={styles.content}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></PremiumScreen>;
  if (!app) return <PremiumScreen contentStyle={styles.content}><Text style={styles.hint}>Loading application…</Text></PremiumScreen>;

  const patchApp = async (body: Record<string, unknown>, busyKey: string, fallback: string): Promise<OnboardingApplicationDto | null> => {
    setBusy(busyKey);
    setError(null);
    try {
      const next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...body, expectedVersion: app.version }),
      });
      accept(next, false);
      return next;
    } catch (err) {
      setError(message(err, fallback));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const upload = async (category: OnboardingMediaCategory, fromCamera: boolean) => {
    if (!(await save(true))) return;
    setError(null);
    let assets: ImagePicker.ImagePickerAsset[] = [];
    try {
      if (fromCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('Camera permission was not given. Use "Upload from phone" instead.');
          return;
        }
        const shot = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
        if (shot.canceled) return;
        assets = shot.assets;
      } else {
        const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 10 });
        if (picked.canceled) return;
        assets = picked.assets;
      }
    } catch {
      setError('Could not open the camera or gallery.');
      return;
    }
    // Camera photos carry private capture metadata (time + GPS, with permission); gallery photos carry none.
    let fix: Location.LocationObject | null = null;
    if (fromCamera && category !== 'CONSENT_EVIDENCE') {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.granted) fix = await Location.getLastKnownPositionAsync({ maxAge: 120_000 }) ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      } catch {
        fix = null;
      }
    }
    let latest: OnboardingApplicationDto | null = null;
    for (const asset of assets) {
      if (typeof asset.fileSize === 'number' && asset.fileSize > ONBOARDING_MEDIA_LIMITS.maxBytes) {
        setError(`${asset.fileName ?? 'This photo'} is larger than 10 MB.`);
        continue;
      }
      setBusy(`upload-${category}`);
      const parameters: Record<string, string> = { category };
      if (fromCamera) {
        parameters.capturedAt = new Date().toISOString();
        if (fix) {
          parameters.captureLatitude = fix.coords.latitude.toFixed(6);
          parameters.captureLongitude = fix.coords.longitude.toFixed(6);
          if (fix.coords.accuracy != null) parameters.captureAccuracy = String(Math.round(fix.coords.accuracy));
        }
      }
      try {
        latest = await uploadImageAsset(asset, 'photo.jpg', (prepared) =>
          apiUploadImage<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}/${EMPLOYEE_PATHS.media}`, prepared, parameters),
        );
        accept(latest, false);
        setNotice('Photo uploaded.');
      } catch (err) {
        setError(uploadMessage(err, 'Could not upload the photo.'));
      } finally {
        setBusy(null);
      }
    }
  };

  const removeMedia = async (mediaId: string) => {
    setBusy(`remove-${mediaId}`);
    try {
      const next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}/${EMPLOYEE_PATHS.media}/${mediaId}`, { method: 'DELETE' });
      accept(next, false);
    } catch (err) {
      setError(message(err, 'Could not remove the photo.'));
    } finally {
      setBusy(null);
    }
  };

  const extract = async (mediaId: string) => {
    if (!(await save(true))) return;
    setBusy(`extract-${mediaId}`);
    setError(null);
    try {
      const result = await apiFetch<MenuExtractionResultDto>(
        `${EMPLOYEE_ONBOARDING}/${app.id}/${EMPLOYEE_PATHS.media}/${mediaId}/${EMPLOYEE_PATHS.extract}`,
        { method: 'POST' },
      );
      const next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}`);
      accept(next, false);
      setRows(rowsFromServices(next.services));
      setNotice(`${result.added} services read from the menu${result.mergedDuplicates ? `, ${result.mergedDuplicates} already listed` : ''}. Check each highlighted row and tick "Confirmed".`);
    } catch (err) {
      setError(message(err, 'The menu could not be read automatically. Enter the services manually.'));
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!(await save(true))) return;
    setBusy('submit');
    setError(null);
    try {
      const next = await apiFetch<OnboardingApplicationDto>(`${EMPLOYEE_ONBOARDING}/${app.id}/${EMPLOYEE_PATHS.submit}`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: app.version }),
      });
      accept(next, true);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError && err.details && typeof err.details === 'object' && 'missing' in err.details) {
        setError('Some required information is still missing. See the list below.');
      } else {
        setError(message(err, 'Could not submit the application.'));
      }
    } finally {
      setBusy(null);
    }
  };

  const captureLocation = async () => {
    setBusy('gps');
    setError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('Location permission was not given. Coordinates were left empty.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      const accuracy = pos.coords.accuracy ?? 9999;
      const next = await patchApp({
        coordinates: { latitude: Number(pos.coords.latitude.toFixed(6)), longitude: Number(pos.coords.longitude.toFixed(6)), source: 'GPS', accuracyMeters: Math.round(accuracy) },
      }, 'gps', 'Could not save the location.');
      if (next) {
        setNotice(accuracy > ONBOARDING_GPS_GOOD_ACCURACY_METERS
          ? `Location saved, but it is only accurate to about ${Math.round(accuracy)} m. Step outside, wait a few seconds and recapture.`
          : 'GPS location saved. Confirm you are at the salon entrance.');
      }
    } catch {
      setError('Could not get the location. Try again outside, or enter latitude / longitude.');
    } finally {
      setBusy(null);
    }
  };

  const saveManualPin = async () => {
    setError(null);
    const pin = parseManualPin(pinLat, pinLng);
    if (pin.kind !== 'ok') {
      setError(pin.kind === 'error' ? pin.message : 'Enter latitude and longitude first.');
      return;
    }
    const next = await patchApp({ coordinates: { latitude: pin.lat, longitude: pin.lng, source: 'MANUAL', accuracyMeters: null } }, 'pin', 'Could not save the location.');
    if (next) {
      setPinLat('');
      setPinLng('');
      setNotice('Latitude / longitude saved. Check the pin on Google Maps.');
    }
  };

  /** PIN -> city, district and state. Only empty fields are filled; a conflict is pointed out. */
  const fillFromPin = async (pin: string) => {
    setPinNote('Looking up this PIN code…');
    let found: PincodeLookupDto | null = null;
    try {
      found = await apiFetch<PincodeLookupDto>(`${DISCOVERY_PATHS.cities}/pincode/${pin}`);
    } catch {
      found = null;
    }
    if (!found) {
      setPinNote('PIN code not found. Please enter the city yourself.');
      return;
    }
    const city = found.city?.name ?? found.district;
    const f = found;
    setForm((current) => {
      const empty = (k: string) => !String(current[k] ?? '').trim();
      return {
        ...current,
        ...(empty('city') ? { city } : {}),
        ...(empty('district') ? { district: f.district } : {}),
        ...(empty('state') ? { state: f.state } : {}),
        ...(empty('country') ? { country: 'India' } : {}),
      };
    });
    setDirty(true);
    const typed = String(form.city ?? '').trim().toLowerCase();
    const known = [city, f.district, ...f.areas].map((v) => v.toLowerCase());
    setPinNote(typed && !known.some((k) => k.includes(typed) || typed.includes(k))
      ? `PIN ${pin} is in ${f.district}, ${f.state}. Please check the city.`
      : `PIN ${pin}: ${f.district}, ${f.state}`);
  };

  // Excel / CSV service list, read on the phone only. Rows stay unconfirmed until checked.
  const importSheet = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await pickServiceSheet();
      if (!result) return;
      if (!result.rows.length) {
        setError(result.notes.join(' ') || `No services found in ${result.fileName}.`);
        return;
      }
      const existing = new Set(rows.map((r) => r.serviceName.trim().toLowerCase()));
      const fresh = result.rows.filter((r) => !existing.has(r.serviceName.trim().toLowerCase()));
      const skipped = result.rows.length - fresh.length;
      setRows((current) => [...current, ...fresh.map((r) => newServiceRow({ ...r, sourceType: 'MANUAL', confirmedByEmployee: false }))]);
      setServicesDirty(true);
      setNotice([
        `${fresh.length} service(s) imported from ${result.fileName}. Check each row and tick "Confirmed".`,
        skipped ? `${skipped} already in the list were skipped.` : '',
        ...result.notes,
      ].filter(Boolean).join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    }
  };

  const updateRow = (key: string, patch: Partial<ServiceRow>) => {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setServicesDirty(true);
  };

  // ---------- field builders ----------
  const text = (key: string, label: string, opts: { required?: boolean; keyboard?: 'phone-pad' | 'email-address' | 'url' | 'number-pad'; placeholder?: string; maxLength?: number; multiline?: boolean } = {}) => (
    <Field label={label} required={opts.required} key={`${key}-${label}`}>
      <PremiumTextField
        value={String(form[key] ?? '')}
        editable={!readOnly}
        keyboardType={opts.keyboard}
        autoCapitalize={opts.keyboard === 'email-address' || opts.keyboard === 'url' ? 'none' : undefined}
        placeholder={opts.placeholder}
        maxLength={opts.maxLength}
        multiline={opts.multiline}
        style={opts.multiline ? styles.multiline : undefined}
        accessibilityLabel={label}
        onChangeText={(v) => set(key, v)}
      />
    </Field>
  );
  const number = (key: string, label: string, required = false) => (
    <Field label={label} required={required} key={key}>
      <PremiumTextField value={String(form[key] ?? '')} editable={!readOnly} keyboardType="number-pad" accessibilityLabel={label} onChangeText={(v) => set(key, v.replace(/\D/g, ''))} />
    </Field>
  );
  const choice = (key: string, label: string, options: Array<[string, string]>, required = false) => (
    <Field label={label} required={required} key={key}>
      <Chips
        options={options}
        isOn={(v) => String(form[key] ?? '') === v}
        disabled={readOnly}
        onToggle={(v) => set(key, String(form[key] ?? '') === v ? '' : v)}
      />
    </Field>
  );
  const yesNo = (key: string, label: string) => choice(key, label, [['true', 'Yes'], ['false', 'No']]);
  const check = (key: string, label: string) => (
    <CheckRow key={key} label={label} value={form[key] === true} disabled={readOnly} onChange={(v) => set(key, v)} />
  );

  if (submitted) {
    return (
      <PremiumScreen contentStyle={styles.content}>
        <PremiumCard>
          <Text style={styles.success}>Submitted for review as {app.reference}. The application is now read-only until the FastQue team reviews it.</Text>
        </PremiumCard>
        <PremiumButton title="Back to Salon Onboarding" onPress={() => navigation.goBack()} />
      </PremiumScreen>
    );
  }

  const menuMedia = app.media.filter((m) => m.category === 'MENU');

  return (
    <View style={styles.flex}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{app.salonName}</Text>
        <Text style={styles.hint}>
          {app.reference} · {ONBOARDING_STATUS_LABELS[app.status]} · {app.assignedEmployee.fullName} ({app.assignedEmployee.employeeCode})
        </Text>
        <Text style={styles.hint}>{busy === 'save' ? 'Saving…' : dirty || servicesDirty ? 'Unsaved changes' : ''}</Text>

        {readOnly ? (
          <PremiumCard>
            <Text style={styles.hint}>
              {app.status === 'REJECTED'
                ? `Rejected: ${app.rejectionReason ?? 'no reason recorded'}`
                : 'This application is with the review team and is read-only. You can edit it again if changes are requested.'}
            </Text>
          </PremiumCard>
        ) : null}
        {app.changeRequest && app.status === 'CHANGES_REQUESTED' ? (
          <PremiumCard>
            <Text style={styles.warn}>Corrections requested:</Text>
            {app.changeRequest.map((item, i) => (
              <Text key={i} style={styles.hint}>• {ONBOARDING_FIELD_LABELS[item.field] ?? item.field}: {item.message}</Text>
            ))}
          </PremiumCard>
        ) : null}

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stepper}>
          {ONBOARDING_STEPS.map((label, index) => {
            const stepHasMissing = missing.some((m) => m.step === index + 1);
            return (
              <Pressable
                key={label}
                accessibilityRole="tab"
                accessibilityState={{ selected: index === step }}
                onPress={() => void goTo(index)}
                style={[styles.stepChip, index === step && styles.stepChipActive]}
              >
                <Text style={[styles.stepText, index === step && styles.stepTextActive]}>
                  {index + 1}. {label}{!stepHasMissing && index < step ? ' ✓' : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text accessibilityRole="text" style={styles.success}>{notice}</Text> : null}

        <PremiumCard style={styles.panel}>
          {step === 0 ? (
            <>
              {text('salonName', 'Salon name', { required: true, maxLength: 160 })}
              {choice('genderCategory', 'Salon category', [['MEN', 'Men'], ['WOMEN', 'Women'], ['UNISEX', 'Unisex']], true)}
              <Field label="Salon type (choose all that apply)" required>
                <Chips
                  options={Object.entries(ONBOARDING_SALON_KIND_LABEL)}
                  isOn={(v) => listHas(form.salonKinds, v)}
                  disabled={readOnly}
                  onToggle={(v) => set('salonKinds', toggleListValue(form.salonKinds, v))}
                />
              </Field>
              {listHas(form.salonKinds, 'OTHER') ? text('salonKindOther', 'Other: please specify', { required: true, maxLength: 160, placeholder: 'e.g. Tattoo studio, piercing, nail art' }) : null}
              {text('brandName', 'Business / brand name')}
              {text('websiteUrl', 'Website', { keyboard: 'url', placeholder: 'https://' })}
              {text('instagramUrl', 'Instagram profile', { keyboard: 'url', placeholder: 'https://instagram.com/…' })}
              {text('mapsUrl', 'Google Maps link', { keyboard: 'url', placeholder: 'https://maps.app.goo.gl/…' })}
              {choice('isFranchise', 'Ownership', [['false', 'Independent'], ['true', 'Franchise']])}
              {number('branchCount', 'Number of branches')}
              {text('description', 'Description (optional)', { multiline: true })}
            </>
          ) : null}

          {step === 1 ? (
            <>
              {text('ownerName', "Owner's full name", { required: true })}
              {text('ownerPhone', "Owner's mobile", { required: true, keyboard: 'phone-pad', placeholder: '10-digit mobile' })}
              {text('ownerWhatsapp', 'WhatsApp number', { keyboard: 'phone-pad' })}
              {text('ownerEmail', "Owner's email", { keyboard: 'email-address' })}
              {text('alternatePhone', 'Alternate contact', { keyboard: 'phone-pad' })}
              {text('preferredLanguage', 'Preferred language', { placeholder: 'Hindi, English…' })}
              {text('managerName', 'Manager name (if different)')}
              {text('managerPhone', 'Manager phone', { keyboard: 'phone-pad' })}
              {check('consentContact', 'The owner agrees that FastQue may contact them and create a FastQue account for this salon.')}
              <Text style={styles.hint}>FastQue never sends a password. After approval the owner gets a one-time link to set their own.</Text>
            </>
          ) : null}

          {step === 2 ? (
            <>
              {text('shopNumber', 'Shop number')}
              {text('buildingName', 'Building / market')}
              {text('streetAddress', 'Street address', { required: true })}
              {text('landmark', 'Landmark')}
              {text('locality', 'Locality / area', { required: true })}
              <Field label="PIN code" required>
                <PremiumTextField
                  value={String(form.postalCode ?? '')}
                  editable={!readOnly}
                  keyboardType="number-pad"
                  maxLength={6}
                  accessibilityLabel="PIN code"
                  onChangeText={(raw) => {
                    const v = raw.replace(/\D/g, '').slice(0, 6);
                    set('postalCode', v);
                    if (v.length === 6) void fillFromPin(v);
                    else setPinNote(null);
                  }}
                />
                {pinNote ? <Text style={styles.hint}>{pinNote}</Text> : null}
              </Field>
              {text('city', 'City', { required: true })}
              {text('district', 'District')}
              {text('state', 'State', { required: true })}
              {text('country', 'Country', { required: true })}
              {text('mapsUrl', 'Google Maps link', { keyboard: 'url' })}

              <Field label="GPS coordinates">
                <PremiumButton
                  title={busy === 'gps' ? 'Getting location…' : app.coordinates ? 'Recapture location' : 'Use my current location'}
                  variant="secondary"
                  disabled={readOnly || !!busy}
                  onPress={() => void captureLocation()}
                />
                <Text style={styles.hint}>
                  {app.coordinates
                    ? `${app.coordinates.latitude}, ${app.coordinates.longitude} (${app.coordinates.source}${app.coordinates.accuracyMeters != null ? ` · ±${Math.round(app.coordinates.accuracyMeters)} m` : ''})`
                    : 'Not captured. Only saved with your permission; never guessed from the address.'}
                </Text>
                {app.coordinates?.accuracyMeters != null && app.coordinates.accuracyMeters > ONBOARDING_GPS_GOOD_ACCURACY_METERS ? (
                  <Text style={styles.warn}>Weak GPS fix (±{Math.round(app.coordinates.accuracyMeters)} m). Move outside the shop, wait a few seconds and recapture.</Text>
                ) : null}
                {app.coordinates ? (
                  <>
                    <CheckRow
                      label={`I captured this standing at the salon entrance${app.locationVerified ? ' (verified)' : ''}`}
                      value={app.locationVerified}
                      disabled={readOnly || busy === 'gps-verify'}
                      onChange={(v) => void patchApp({ locationVerified: v }, 'gps-verify', 'Could not save the location check.')}
                    />
                    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`https://www.google.com/maps?q=${app.coordinates?.latitude},${app.coordinates?.longitude}`)}>
                      <Text style={styles.link}>Check the pin on Google Maps ↗</Text>
                    </Pressable>
                  </>
                ) : null}
              </Field>

              <Field label="Latitude / Longitude (optional)">
                <PremiumTextField
                  value={pinLat}
                  editable={!readOnly}
                  keyboardType="numbers-and-punctuation"
                  maxLength={40}
                  placeholder="Latitude, e.g. 28.61394"
                  accessibilityLabel="Latitude"
                  onChangeText={(v) => {
                    const both = v.match(LAT_LNG_PAIR);
                    if (both) {
                      setPinLat(both[1]);
                      setPinLng(both[2]);
                    } else setPinLat(v);
                  }}
                />
                <PremiumTextField value={pinLng} editable={!readOnly} keyboardType="numbers-and-punctuation" maxLength={20} placeholder="Longitude, e.g. 77.20902" accessibilityLabel="Longitude" onChangeText={setPinLng} />
                <PremiumButton title={busy === 'pin' ? 'Saving…' : 'Save lat / long'} variant="secondary" disabled={readOnly || !!busy} onPress={() => void saveManualPin()} />
                <Text style={styles.hint}>Google Maps mein shop par long-press karke numbers copy karein aur Latitude box mein paste karein.</Text>
              </Field>
              <Text style={styles.preview}>{addressPreview(form) || 'The address preview appears here as you type.'}</Text>
            </>
          ) : null}

          {step === 3 ? (
            <>
              {number('employeeCount', 'Total employees', true)}
              {number('chairCount', 'Total service chairs', true)}
              {number('activeChairCount', 'Active chairs')}
              {number('averageServiceMinutes', 'Average service time (min)')}
              {number('maleStaffCount', 'Male staff (if separate)')}
              {number('femaleStaffCount', 'Female staff (if separate)')}
              {yesNo('walkInsAccepted', 'Walk-ins accepted')}
              {yesNo('bookingsAccepted', 'Scheduled bookings accepted')}
              {yesNo('liveQueueSupported', 'Live queue supported')}
              {number('appointmentIntervalMinutes', 'Appointment interval (min)')}
              <Field label="Weekly hours (24-hour time, e.g. 09:30 and 21:00)" required>
                <PremiumButton
                  title="Copy Monday to all days"
                  variant="quiet"
                  disabled={readOnly}
                  onPress={() => {
                    const monday = hours.find((h) => h.dayOfWeek === 1);
                    if (!monday) return;
                    setHours((current) => current.map((h) => ({ ...monday, dayOfWeek: h.dayOfWeek })));
                    setDirty(true);
                  }}
                />
                {WEEK_DAYS.map(({ day, label }) => {
                  const row = hours.find((h) => h.dayOfWeek === day) as OnboardingHoursDto;
                  const overnight = !row.isClosed && !!row.opensAt && !!row.closesAt && row.closesAt < row.opensAt;
                  const patch = (p: Partial<OnboardingHoursDto>) => {
                    setHours((current) => current.map((h) => (h.dayOfWeek === day ? { ...h, ...p } : h)));
                    setDirty(true);
                  };
                  return (
                    <View key={day} style={styles.hoursRow}>
                      <Text style={styles.dayLabel}>{label.slice(0, 3)}</Text>
                      <CheckRow label="Closed" value={row.isClosed} disabled={readOnly} onChange={(v) => patch({ isClosed: v })} compact />
                      {!row.isClosed ? (
                        <>
                          <PremiumTextField style={styles.time} value={row.opensAt ?? ''} editable={!readOnly} placeholder="09:00" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={`${label} opens`} onChangeText={(v) => patch({ opensAt: v ? normaliseTime(v) : null })} />
                          <PremiumTextField style={styles.time} value={row.closesAt ?? ''} editable={!readOnly} placeholder="21:00" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={`${label} closes`} onChangeText={(v) => patch({ closesAt: v ? normaliseTime(v) : null })} />
                        </>
                      ) : null}
                      {overnight ? <Text style={styles.hint}>Closes after midnight</Text> : null}
                    </View>
                  );
                })}
              </Field>
              {number('washStationCount', 'Hair wash stations')}
              <Field label="Weekly holiday(s)">
                <Chips
                  options={WEEK_DAYS.map(({ day, label }) => [String(day), label.slice(0, 3)] as [string, string])}
                  isOn={(v) => listHas(form.weeklyHolidays, v)}
                  disabled={readOnly}
                  onToggle={(v) => set('weeklyHolidays', toggleListValue(form.weeklyHolidays, v))}
                />
              </Field>
              <Field label="Amenities">
                <Chips
                  options={ONBOARDING_AMENITIES.map((a) => [a, ONBOARDING_AMENITY_LABEL[a]] as [string, string])}
                  isOn={(v) => listHas(form.amenities, v)}
                  disabled={readOnly}
                  onToggle={(v) => set('amenities', toggleListValue(form.amenities, v))}
                />
              </Field>
              {yesNo('qrInstallReady', 'Ready to put up the FastQue QR code')}
              {yesNo('inventoryInterest', 'Interested in buying products from the FastQue marketplace')}
              {choice('ownerTrainingStatus', 'Owner training', [['NOT_STARTED', 'Not started'], ['SCHEDULED', 'Scheduled'], ['COMPLETED', 'Completed']])}
              {text('specialTimings', 'Weekly holidays, special or festival timings', { multiline: true })}
            </>
          ) : null}

          {step === 4 ? (
            <>
              <Text style={styles.hint}>
                Enter every service with its price and how long it takes. Never guess a duration: ask the owner. Rows read from a menu photo or a file stay unconfirmed until you check them and tick &quot;Confirmed&quot;.
              </Text>
              <Text style={styles.sectionTitle}>Menu photos ({menuMedia.length})</Text>
              <PhotoButtons category="MENU" busy={busy} readOnly={readOnly} onPick={upload} />
              {menuMedia.map((m, i) => (
                <View key={m.id} style={styles.photoCard}>
                  <PrivateImage media={m} alt={`Menu page ${i + 1}`} />
                  <View style={styles.rowWrap}>
                    <PremiumButton title={busy === `extract-${m.id}` ? 'Reading…' : 'Read menu'} variant="secondary" disabled={readOnly || !!busy} onPress={() => void extract(m.id)} style={styles.flex} />
                    {!readOnly ? <PremiumButton title="Remove" variant="quiet" disabled={!!busy} onPress={() => void removeMedia(m.id)} style={styles.flex} /> : null}
                  </View>
                </View>
              ))}

              <Text style={styles.sectionTitle}>Services ({rows.length})</Text>
              {!readOnly ? (
                <View style={styles.rowWrap}>
                  <PremiumButton title="+ Add service" onPress={() => { setRows((r) => [...r, newServiceRow()]); setServicesDirty(true); }} style={styles.flex} />
                  {sheetImport ? <PremiumButton title="Import Excel / CSV" variant="secondary" disabled={!!busy} onPress={() => void importSheet()} style={styles.flex} /> : null}
                </View>
              ) : null}
              {!readOnly && sheetImport ? (
                <Pressable accessibilityRole="button" onPress={() => void shareServiceSheetTemplate().catch(() => undefined)}>
                  <Text style={styles.link}>Share template (columns: Service name, Category, Gender, Price, Price type, Discounted price, Duration, Description)</Text>
                </Pressable>
              ) : null}
              {rows.length === 0 ? <Text style={styles.hint}>No services yet. Add them by hand, import an Excel / CSV file, or read a menu photo.</Text> : null}
              {rows.map((row) => {
                const unsure = (field: string) => (row.uncertainFields ?? []).includes(field) && !row.confirmedByEmployee;
                return (
                  <View key={row.key} style={[styles.serviceRow, !row.confirmedByEmployee && styles.serviceUnconfirmed]}>
                    <Field label="Service name">
                      <PremiumTextField value={row.serviceName} editable={!readOnly} accessibilityLabel="Service name" onChangeText={(v) => updateRow(row.key, { serviceName: v, confirmedByEmployee: false })} />
                    </Field>
                    <View style={styles.rowWrap}>
                      <View style={styles.flex}>
                        <Field label="Price (₹)" warn={unsure('basePrice')}>
                          <PremiumTextField value={row.basePrice == null ? '' : String(row.basePrice)} editable={!readOnly} keyboardType="decimal-pad" accessibilityLabel="Price" onChangeText={(v) => updateRow(row.key, { basePrice: v === '' ? null : Number(v) })} />
                        </Field>
                      </View>
                      <View style={styles.flex}>
                        <Field label="Duration (min)" warn={!row.durationMinutes}>
                          <PremiumTextField value={row.durationMinutes == null ? '' : String(row.durationMinutes)} editable={!readOnly} keyboardType="number-pad" accessibilityLabel="Duration" onChangeText={(v) => updateRow(row.key, { durationMinutes: v === '' ? null : Number(v.replace(/\D/g, '')) })} />
                        </Field>
                      </View>
                    </View>
                    <Field label="Price type">
                      <Chips options={[['FIXED', 'Fixed'], ['STARTS_FROM', 'Starts from']]} isOn={(v) => (row.priceType ?? 'FIXED') === v} disabled={readOnly} onToggle={(v) => updateRow(row.key, { priceType: v as 'FIXED' | 'STARTS_FROM' })} />
                    </Field>
                    <Field label="For">
                      <Chips
                        options={[['MEN', 'Men'], ['WOMEN', 'Women'], ['UNISEX', 'Unisex']]}
                        isOn={(v) => row.applicableGender === v}
                        disabled={readOnly}
                        onToggle={(v) => updateRow(row.key, { applicableGender: (row.applicableGender === v ? null : v) as ServiceRow['applicableGender'] })}
                      />
                    </Field>
                    <View style={styles.rowWrap}>
                      <View style={styles.flex}>
                        <Field label="Category">
                          <PremiumTextField value={row.category ?? ''} editable={!readOnly} accessibilityLabel="Category" onChangeText={(v) => updateRow(row.key, { category: v || null })} />
                        </Field>
                      </View>
                      <View style={styles.flex}>
                        <Field label="Discounted price (₹)">
                          <PremiumTextField value={row.discountedPrice == null ? '' : String(row.discountedPrice)} editable={!readOnly} keyboardType="decimal-pad" accessibilityLabel="Discounted price" onChangeText={(v) => updateRow(row.key, { discountedPrice: v === '' ? null : Number(v) })} />
                        </Field>
                      </View>
                    </View>
                    <CheckRow label="Active" value={row.isActive ?? true} disabled={readOnly} onChange={(v) => updateRow(row.key, { isActive: v })} />
                    <CheckRow
                      label="Confirmed with owner"
                      value={row.confirmedByEmployee ?? false}
                      disabled={readOnly}
                      onChange={(v) => updateRow(row.key, { confirmedByEmployee: v, uncertainFields: v ? [] : row.uncertainFields })}
                    />
                    {row.sourceType === 'AI_EXTRACTED' ? (
                      <Text style={styles.warn}>From menu photo{row.extractionConfidence != null ? ` · ${Math.round(row.extractionConfidence * 100)}% sure` : ''}</Text>
                    ) : null}
                    {!readOnly ? (
                      <PremiumButton title="Remove service" variant="quiet" onPress={() => { setRows((r) => r.filter((x) => x.key !== row.key)); setServicesDirty(true); }} />
                    ) : null}
                  </View>
                );
              })}
            </>
          ) : null}

          {step === 5 ? (
            <>
              <Text style={styles.hint}>
                At least one exterior, interior, stations or reception photo is required. Photos stay private until FastQue approves them for the public profile. JPG, PNG or WebP up to 10 MB.
              </Text>
              {ONBOARDING_PHOTO_SLOTS.map((group) => {
                const items = app.media.filter((m) => m.category === group.category);
                return (
                  <View key={group.category} style={styles.photoGroup}>
                    <Text style={styles.sectionTitle}>
                      {group.label}{ONBOARDING_SHOP_PHOTO_CATEGORIES.includes(group.category) ? '' : ' (optional)'} · {items.length}
                    </Text>
                    <Text style={styles.hint}>{group.hint}</Text>
                    <PhotoButtons category={group.category} busy={busy} readOnly={readOnly} onPick={upload} />
                    {items.map((m) => (
                      <View key={m.id} style={styles.photoCard}>
                        <PrivateImage media={m} alt={`${group.label} photo`} />
                        <Text style={styles.hint}>{m.uploadedBy}{m.gpsTagged ? ' · GPS-tagged' : ''}</Text>
                        {!readOnly ? <PremiumButton title="Remove" variant="quiet" disabled={busy === `remove-${m.id}`} onPress={() => void removeMedia(m.id)} /> : null}
                      </View>
                    ))}
                  </View>
                );
              })}
            </>
          ) : null}

          {step === 6 ? (
            <>
              {check('consentAccuracy', 'The owner confirms the salon information is accurate.')}
              {check('consentListing', 'The owner consents to the FastQue listing and to FastQue processing these contact details.')}
              {check('consentAuthorization', 'The owner authorises the content I collected (details, photos, menu) to be submitted.')}
              {check('consentContact', 'The owner agrees to be contacted and to have a FastQue account created.')}
              {choice('consentMethod', 'How did the owner give consent?', Object.entries(ONBOARDING_CONSENT_METHOD_LABEL), true)}
              {text('consentByName', 'Consent given by (name)', { required: true, maxLength: 120 })}
              {text('consentByRole', 'Their role', { placeholder: 'Owner, partner, manager…', maxLength: 40 })}
              {text('consentEvidenceNote', 'Consent evidence note', { multiline: true, maxLength: 500, placeholder: 'e.g. WhatsApp confirmation received at 4:10 pm. Attach the screenshot under Photos → Owner consent evidence.' })}
              {text('gstin', 'GSTIN (optional)', { maxLength: 15 })}
              {text('businessRegistration', 'Business registration details (optional)')}
              {text('employeeNotes', 'Employee notes', { multiline: true })}
              {text('openQuestions', 'Unresolved questions', { multiline: true })}
              <Text style={styles.hint}>Do not collect Aadhaar, PAN or other identity documents.</Text>
            </>
          ) : null}

          {step === 7 ? (
            <>
              {missing.length > 0 ? (
                <>
                  <Text style={styles.warn}>Still missing before you can submit:</Text>
                  {missing.map((m, i) => (
                    <Pressable key={i} accessibilityRole="button" onPress={() => void goTo(m.step - 1)}>
                      <Text style={styles.link}>Step {m.step}: {m.message}</Text>
                    </Pressable>
                  ))}
                </>
              ) : (
                <Text style={styles.success}>Everything required is filled in. Check the summary and submit.</Text>
              )}
              <Summary title="Salon" lines={[
                `Name: ${v(form, 'salonName')}`,
                `Category: ${v(form, 'genderCategory')}`,
                `Type: ${salonKindsText(String(form.salonKinds ?? '').split(',').filter(Boolean), String(form.salonKindOther ?? '')) || '—'}`,
              ]} />
              <Summary title="Owner" lines={[
                `Name: ${v(form, 'ownerName')}`,
                `Mobile: ${v(form, 'ownerPhone')}`,
                `Email: ${v(form, 'ownerEmail')}`,
                `Consent: ${['consentContact', 'consentListing', 'consentAccuracy', 'consentAuthorization'].filter((k) => form[k] === true).length} of 4 confirmations`,
              ]} />
              <Summary title="Address" lines={[addressPreview(form) || 'Not entered']} />
              <Summary title="Operations" lines={[
                `Staff: ${v(form, 'employeeCount')} · Chairs: ${v(form, 'chairCount')}`,
                ...WEEK_DAYS.map(({ day, label }) => {
                  const h = hours.find((x) => x.dayOfWeek === day);
                  return `${label.slice(0, 3)}: ${!h ? '—' : h.isClosed ? 'Closed' : h.opensAt && h.closesAt ? `${h.opensAt}–${h.closesAt}` : 'Not entered'}`;
                }),
              ]} />
              <Summary title={`Services (${rows.length})`} lines={rows.map((r) =>
                `${r.serviceName || 'Unnamed'}: ${r.priceType === 'STARTS_FROM' ? 'from ' : ''}${formatInr(r.basePrice ?? null)} · ${r.durationMinutes ? `${r.durationMinutes} min` : 'duration missing'}${r.confirmedByEmployee ? '' : ' · unconfirmed'}`)} />
              <Summary title={`Photos (${app.media.length})`} lines={[]} />
            </>
          ) : null}
        </PremiumCard>
      </ScrollView>

      <View style={styles.navBar}>
        <PremiumButton title="← Back" variant="secondary" disabled={step === 0 || !!busy} onPress={() => void goTo(step - 1)} style={styles.flex} />
        {!readOnly ? (
          <PremiumButton title={busy === 'save' ? 'Saving…' : 'Save'} variant="secondary" disabled={!!busy || (!dirty && !servicesDirty)} onPress={() => void save(false)} style={styles.flex} />
        ) : null}
        {step < ONBOARDING_STEPS.length - 1 ? (
          <PremiumButton title="Next →" disabled={!!busy} onPress={() => void goTo(step + 1)} style={styles.flex} />
        ) : !readOnly ? (
          <PremiumButton
            title={busy === 'submit' ? 'Submitting…' : app.status === 'CHANGES_REQUESTED' ? 'Resubmit' : 'Submit'}
            disabled={!!busy || missing.length > 0}
            onPress={() => void submit()}
            style={styles.flex}
          />
        ) : null}
      </View>
    </View>
  );
}

function v(form: DraftForm, key: string): string {
  const value = form[key];
  return value === '' || value === null || value === undefined ? 'Not entered' : String(value);
}

function Field({ label, required, warn, children }: { label: string; required?: boolean; warn?: boolean; children: ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, warn && styles.warn]}>{label}{required ? ' *' : ''}</Text>
      {children}
    </View>
  );
}

function Chips({ options, isOn, onToggle, disabled }: { options: Array<[string, string]>; isOn: (value: string) => boolean; onToggle: (value: string) => void; disabled?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.chips}>
      {options.map(([value, label]) => {
        const on = isOn(value);
        return (
          <Pressable key={value} accessibilityRole="checkbox" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={() => onToggle(value)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CheckRow({ label, value, onChange, disabled, compact }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: boolean; compact?: boolean }) {
  const styles = useThemedStyles(makeStyles);
  const { fastQue } = useThemeTokens();
  return (
    <View style={[styles.checkRow, compact && styles.checkCompact]}>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: fastQue.pink, false: fastQue.border }} accessibilityLabel={label} />
      <Text style={[styles.checkLabel, compact && styles.checkLabelCompact]}>{label}</Text>
    </View>
  );
}

function PhotoButtons({ category, busy, readOnly, onPick }: {
  category: OnboardingMediaCategory;
  busy: string | null;
  readOnly: boolean;
  onPick: (category: OnboardingMediaCategory, fromCamera: boolean) => void | Promise<void>;
}) {
  const styles = useThemedStyles(makeStyles);
  if (readOnly) return null;
  return (
    <View style={styles.rowWrap}>
      <PremiumButton title={busy === `upload-${category}` ? 'Uploading…' : 'Take photo'} variant="secondary" disabled={!!busy} onPress={() => void onPick(category, true)} style={styles.flex} />
      <PremiumButton title="Upload from phone" variant="secondary" disabled={!!busy} onPress={() => void onPick(category, false)} style={styles.flex} />
    </View>
  );
}

/** Onboarding photos are private: loaded with the signed-in user's token, never from a public link. */
function PrivateImage({ media, alt }: { media: OnboardingMediaDto; alt: string }) {
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const token = getAccessToken();
  if (failed || !token) return <Text style={styles.hint}>Image unavailable</Text>;
  return (
    <Image
      accessibilityLabel={alt}
      style={styles.photo}
      resizeMode="cover"
      onError={() => setFailed(true)}
      source={{ uri: `${getApiBaseUrl()}/${media.filePath.replace(/^\//, '')}`, headers: { Authorization: `Bearer ${token}` } }}
    />
  );
}

function Summary({ title, lines }: { title: string; lines: string[] }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.summary}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {lines.map((line, i) => <Text key={i} style={styles.hint}>{line}</Text>)}
    </View>
  );
}

const makeStyles = ({ fastQue }: ThemeTokens) => StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: space[4], paddingBottom: space[7], gap: space[2], backgroundColor: fastQue.background, flexGrow: 1 },
  title: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.xl },
  sectionTitle: { color: fastQue.text, fontFamily: font.bodyBold, fontSize: fontSize.base, marginTop: space[3], marginBottom: space[1] },
  hint: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20 },
  error: { color: fastQue.error, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  success: { color: fastQue.success, fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: 20 },
  warn: { color: fastQue.warning, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  link: { color: fastQue.pink, fontFamily: font.bodySemiBold, fontSize: fontSize.sm, paddingVertical: space[2] },
  panel: { gap: space[1] },
  field: { marginTop: space[2], gap: space[1] },
  label: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  multiline: { minHeight: 88, textAlignVertical: 'top', paddingTop: space[2] },
  preview: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border },
  stepper: { gap: space[2], paddingVertical: space[2] },
  stepChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border },
  stepChipActive: { borderColor: fastQue.pink, backgroundColor: fastQue.glassStrong },
  stepText: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  stepTextActive: { color: fastQue.text, fontFamily: font.bodySemiBold },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  chip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border },
  chipOn: { borderColor: fastQue.pink, backgroundColor: fastQue.glassStrong },
  chipText: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.sm },
  chipTextOn: { color: fastQue.text, fontFamily: font.bodySemiBold },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[2] },
  checkCompact: { marginTop: 0 },
  checkLabel: { flex: 1, color: fastQue.text, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20 },
  checkLabelCompact: { flex: 0 },
  hoursRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border },
  dayLabel: { width: 40, color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  time: { width: 84, minHeight: 44 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  photoGroup: { marginTop: space[2] },
  photoCard: { marginTop: space[2], gap: space[1] },
  photo: { width: '100%', height: 180, borderRadius: radius.md, backgroundColor: fastQue.border },
  serviceRow: { marginTop: space[3], padding: space[3], borderRadius: radius.md, borderWidth: 1, borderColor: fastQue.border },
  serviceUnconfirmed: { borderColor: fastQue.warning },
  summary: { marginTop: space[2] },
  navBar: { flexDirection: 'row', gap: space[2], padding: space[3], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, backgroundColor: fastQue.background },
});
