import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  SalonStatus,
  SHOP_CLOSED_TODAY_MESSAGE,
  updateSalonProfileSchema,
  type PublicQueueQrDto,
  type RegisterSalonResultDto,
  type SalonProfileDetailDto,
  type SalonSetupReadinessDto,
  type SalonStatusResultDto,
  type SalonTimezoneResultDto,
  type UiStrings,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useLanguage } from '../../lib/language-context';
import { filterTimeZones, isReady, isSetupIncomplete, readinessFromDetails, statusLabel, supportedTimeZones } from '../../lib/owner/settings';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { InlineError, PremiumButton, PremiumCard } from '../ui';
import { QrCode } from './QrCode';

const salonBase = (salonId: string) => `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}`;

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

// ---------- profile ----------

type ProfileForm = { name: string; phone: string; email: string; addressLine: string; postalCode: string; description: string };

const toForm = (dto: SalonProfileDetailDto): ProfileForm => ({
  name: dto.name,
  phone: dto.phone ?? '',
  email: dto.email ?? '',
  addressLine: dto.addressLine,
  postalCode: dto.postalCode ?? '',
  description: dto.description ?? '',
});

export function ProfileSection({ salonId, onSaved }: { salonId: string; onSaved?: (profile: SalonProfileDetailDto) => void }) {
  const { t } = useLanguage();
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const path = `${salonBase(salonId)}/${DASHBOARD_PATHS.profile}`;

  useEffect(() => {
    let cancelled = false;
    setForm(null);
    setError(null);
    setSaved(false);
    apiFetch<SalonProfileDetailDto>(path)
      .then((result) => {
        if (!cancelled) setForm(toForm(result));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t.profileLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [path, t]);

  const update = (patch: Partial<ProfileForm>) => {
    setForm((previous) => (previous ? { ...previous, ...patch } : previous));
    setSaved(false);
  };

  async function save() {
    if (!form) return;
    const parsed = updateSalonProfileSchema.safeParse({
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      addressLine: form.addressLine.trim(),
      postalCode: form.postalCode.trim(),
      description: form.description.trim(),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.profileSaveFailed);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const result = await apiFetch<SalonProfileDetailDto>(path, { method: 'PATCH', body: JSON.stringify(parsed.data) });
      setForm(toForm(result));
      setSaved(true);
      onSaved?.(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.profileSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  const fields: Array<{ key: keyof ProfileForm; label: string; multiline?: boolean; keyboard?: 'default' | 'phone-pad' | 'email-address' }> = [
    { key: 'name', label: t.profileName },
    { key: 'phone', label: t.profilePhone, keyboard: 'phone-pad' },
    { key: 'email', label: t.profileEmail, keyboard: 'email-address' },
    { key: 'addressLine', label: t.profileAddress },
    { key: 'postalCode', label: t.profilePostalCode },
    { key: 'description', label: t.profileDescription, multiline: true },
  ];

  return (
    <PremiumCard style={styles.card} testID="settings-profile">
      <SectionTitle title={t.profileTitle} hint={t.profileHint} />
      {error ? <InlineError message={error} /> : null}
      {form
        ? fields.map((field) => (
            <View key={field.key} style={styles.field}>
              <Text style={styles.label}>{field.label}</Text>
              <TextInput
                testID={`profile-${field.key}`}
                value={form[field.key]}
                onChangeText={(value) => update({ [field.key]: value } as Partial<ProfileForm>)}
                multiline={field.multiline}
                keyboardType={field.keyboard ?? 'default'}
                autoCapitalize={field.key === 'email' ? 'none' : 'sentences'}
                style={[styles.input, field.multiline && styles.multiline]}
                placeholderTextColor={fastQue.textMuted}
              />
            </View>
          ))
        : null}
      {form ? (
        <PremiumButton testID="profile-save" title={saving ? t.savingEllipsis : t.profileSave} onPress={() => void save()} loading={saving} style={styles.button} />
      ) : null}
      {saved ? (
        <Text testID="profile-saved" style={styles.success}>
          {t.profileSaved}
        </Text>
      ) : null}
    </PremiumCard>
  );
}

// ---------- shop status ----------

export function ShopStatusSection({
  salonId,
  salon,
  readiness,
  onChanged,
  onContinueSetup,
}: {
  salonId: string;
  salon: RegisterSalonResultDto;
  readiness: SalonSetupReadinessDto | null;
  onChanged: (next: { status: SalonStatus; isClosedForToday: boolean }) => void;
  onContinueSetup: () => void;
}) {
  const { t } = useLanguage();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverReadiness, setServerReadiness] = useState<SalonSetupReadinessDto | null>(null);
  const shown = serverReadiness ?? readiness;
  const closedToday = salon.status === SalonStatus.ACTIVE && Boolean(salon.isClosedForToday);

  async function change(status: SalonStatus) {
    setError(null);
    setServerReadiness(null);
    setUpdating(true);
    try {
      const result = await apiFetch<SalonStatusResultDto>(`${salonBase(salonId)}/${DASHBOARD_PATHS.status}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onChanged({ status: result.status, isClosedForToday: result.isClosedForToday ?? false });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.shopStatusUpdateFailed);
      // The server refused to open the shop and said exactly what is missing: trust that over the
      // locally derived counts, which may be stale.
      if (err instanceof ApiError && isSetupIncomplete(err.code)) setServerReadiness(readinessFromDetails(err.details));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <PremiumCard style={styles.card} testID="settings-status">
      <SectionTitle title={t.shopStatusTitle} />
      {error ? <InlineError message={error} /> : null}
      {closedToday ? (
        <>
          <Text style={styles.warn}>
            {SHOP_CLOSED_TODAY_MESSAGE} {t.shopStatusClosedTodayNote}
          </Text>
          <PremiumButton testID="status-open" title={updating ? t.shopStatusUpdating : t.shopStatusOpenAction} onPress={() => void change(SalonStatus.ACTIVE)} loading={updating} style={styles.button} />
        </>
      ) : salon.status === SalonStatus.ACTIVE ? (
        <>
          <Text style={styles.ok}>{t.shopStatusOpenNote}</Text>
          <PremiumButton testID="status-close" title={updating ? t.shopStatusUpdating : t.shopStatusCloseAction} variant="secondary" onPress={() => void change(SalonStatus.SUSPENDED)} loading={updating} style={styles.button} />
        </>
      ) : (
        <>
          <Text style={styles.warn}>{t.shopStatusNotOpenNote.replace('{status}', statusLabel(salon.status, false, t).toLowerCase())}</Text>
          {salon.status === SalonStatus.PENDING && shown && !isReady(shown) ? <Readiness readiness={shown} t={t} /> : null}
          {shown && isReady(shown) ? (
            <PremiumButton testID="status-open" title={updating ? t.shopStatusUpdating : t.shopStatusOpenAction} onPress={() => void change(SalonStatus.ACTIVE)} loading={updating} style={styles.button} />
          ) : (
            <PremiumButton testID="status-continue-setup" title={t.readinessContinueSetup} variant="secondary" onPress={onContinueSetup} style={styles.button} />
          )}
        </>
      )}
    </PremiumCard>
  );
}

function Readiness({ readiness, t }: { readiness: SalonSetupReadinessDto; t: UiStrings }) {
  const items = [
    { done: readiness.hasActiveService, label: t.readinessAddService, doneLabel: t.readinessServiceDone, id: 'service' },
    { done: readiness.hasActiveChair, label: t.readinessAddChair, doneLabel: t.readinessChairDone, id: 'chair' },
    { done: readiness.hasActiveStaff, label: t.readinessAddBarber, doneLabel: t.readinessBarberDone, id: 'barber' },
  ];
  return (
    <View style={styles.readiness} testID="settings-readiness">
      <Text style={styles.warn}>{t.readinessCantOpen}</Text>
      {items.map((item) => (
        <Text key={item.id} testID={`readiness-${item.id}`} style={item.done ? styles.ok : styles.warn}>
          {item.done ? '✓ ' : '✗ '}
          {item.done ? item.doneLabel : item.label}
        </Text>
      ))}
    </View>
  );
}

// ---------- time zone ----------

const SOURCE_KEY = {
  coordinates: 'timezoneSourceCoordinates',
  city: 'timezoneSourceCity',
  country: 'timezoneSourceCountry',
} as const;

export function TimezoneSection({ salonId }: { salonId: string }) {
  const { t } = useLanguage();
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [result, setResult] = useState<SalonTimezoneResultDto | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `${salonBase(salonId)}/${DASHBOARD_PATHS.timezone}`;
  const zones = useMemo(() => supportedTimeZones(current === undefined ? null : current), [current]);
  const matches = useMemo(() => filterTimeZones(zones, query), [zones, query]);

  useEffect(() => {
    let cancelled = false;
    setCurrent(undefined);
    setError(null);
    apiFetch<SalonTimezoneResultDto>(path)
      .then((value) => {
        if (cancelled) return;
        setResult(value);
        setCurrent(value.timezone);
        // Nothing stored yet: the picker starts on the detected suggestion, but nothing is saved
        // until the owner presses Save.
        setSelected(value.timezone ?? value.suggestion?.timezone ?? '');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t.timezoneLoadFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [path, t]);

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const value = await apiFetch<SalonTimezoneResultDto>(path, { method: 'PATCH', body: JSON.stringify({ timezone: selected }) });
      setResult(value);
      setCurrent(value.timezone);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.timezoneSaveFailed);
    } finally {
      setSaving(false);
    }
  }

  const suggestion = result?.suggestion ?? null;
  const showSuggestion = suggestion !== null && selected !== suggestion.timezone && !result?.timezoneManuallyOverridden;

  return (
    <PremiumCard style={styles.card} testID="settings-timezone">
      <SectionTitle title={t.timezoneTitle} hint={t.timezoneHint} />
      {error ? <InlineError message={error} /> : null}
      {current !== undefined ? (
        <>
          <Text style={styles.line}>{t.timezoneCurrent.replace('{zone}', current ?? t.timezoneNotSet)}</Text>
          {showSuggestion && suggestion ? (
            <View style={styles.suggestion}>
              <Text style={styles.line}>
                {t.timezoneDetected.replace('{source}', t[SOURCE_KEY[suggestion.source]]).replace('{zone}', suggestion.timezone)}
              </Text>
              <PremiumButton
                testID="timezone-use-suggestion"
                title={t.timezoneUse.replace('{zone}', suggestion.timezone)}
                variant="secondary"
                onPress={() => {
                  setSelected(suggestion.timezone);
                  setSaved(false);
                }}
                style={styles.button}
              />
            </View>
          ) : null}
          {suggestion === null && current === null ? <Text style={styles.warn}>{t.timezoneCouldntDetect}</Text> : null}
          <TextInput
            testID="timezone-search"
            value={query}
            onChangeText={setQuery}
            placeholder={t.timezoneSearchPlaceholder}
            placeholderTextColor={fastQue.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
          <View style={styles.zoneList}>
            {matches.map((zone) => (
              <Pressable
                key={zone}
                testID={`timezone-option-${zone}`}
                onPress={() => {
                  setSelected(zone);
                  setSaved(false);
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: zone === selected }}
                style={[styles.zoneRow, zone === selected && styles.zoneRowSelected]}
              >
                <Text style={[styles.zoneText, zone === selected && styles.zoneTextSelected]}>{zone}</Text>
              </Pressable>
            ))}
          </View>
          <PremiumButton
            testID="timezone-save"
            title={saving ? t.savingEllipsis : t.timezoneSave}
            onPress={() => void save()}
            loading={saving}
            disabled={!selected || selected === current}
            style={styles.button}
          />
          {saved ? (
            <Text testID="timezone-saved" style={styles.success}>
              {t.timezoneSaved}
            </Text>
          ) : null}
        </>
      ) : null}
    </PremiumCard>
  );
}

// ---------- queue QR ----------

export function QueueQrSection({ salonId, salonName }: { salonId: string; salonName: string }) {
  const { t } = useLanguage();
  const [qr, setQr] = useState<PublicQueueQrDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    setQr(null);
    setError(null);
    apiFetch<PublicQueueQrDto>(`${salonBase(salonId)}/${DASHBOARD_PATHS.queueQr}`)
      .then((value) => {
        if (request === requestRef.current) setQr(value);
      })
      .catch((err: unknown) => {
        if (request === requestRef.current) setError(err instanceof ApiError ? err.message : t.queueQrLoadFailed);
      });
  }, [salonId, t]);

  return (
    <PremiumCard style={styles.card} testID="settings-queue-qr">
      <SectionTitle title={t.queueQrTitle} hint={t.queueQrHint} />
      {error ? <InlineError message={error} /> : null}
      {qr ? (
        <>
          {/* The URL is exactly what the backend returned (the public queue link) — never rebuilt here. */}
          <QrCode value={qr.publicQueueUrl} fallbackLabel={qr.publicQueueUrl} />
          <Text testID="queue-qr-url" selectable style={styles.url}>
            {qr.publicQueueUrl}
          </Text>
          <PremiumButton
            testID="queue-qr-share"
            title={t.queueQrShare}
            variant="secondary"
            onPress={() => void Share.share({ message: t.queueQrShareMessage.replace('{shop}', salonName).replace('{url}', qr.publicQueueUrl) })}
            style={styles.button}
          />
        </>
      ) : null}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  sectionHead: { marginBottom: space[3] },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: fastQue.text },
  hint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, marginTop: 2 },
  field: { marginBottom: space[3] },
  label: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: fastQue.text, marginBottom: space[1] },
  input: {
    minHeight: 48,
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    paddingHorizontal: space[3],
    fontSize: fontSize.base,
  },
  multiline: { minHeight: 90, textAlignVertical: 'top', paddingTop: space[3] },
  button: { marginTop: space[2], alignSelf: 'flex-start' },
  success: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: '#4CC38A', marginTop: space[2] },
  ok: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: '#4CC38A', marginBottom: space[1] },
  warn: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.orange, marginBottom: space[2] },
  line: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary, marginBottom: space[2] },
  readiness: { marginBottom: space[2] },
  suggestion: { marginBottom: space[3] },
  zoneList: { marginTop: space[2], maxHeight: 220, overflow: 'hidden' },
  zoneRow: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderRadius: radius.sm },
  zoneRowSelected: { backgroundColor: 'rgba(242,10,131,0.14)' },
  zoneText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary },
  zoneTextSelected: { fontFamily: font.bodyBold, color: fastQue.pink },
  url: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted, textAlign: 'center', marginTop: space[2] },
});
