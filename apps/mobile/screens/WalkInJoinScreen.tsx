import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  QUEUE_ENTRIES_PATH,
  SALON_QUEUE_PATHS,
  normalizeContactName,
  normalizeContactPhone,
  type QueueEntryDetailDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';
import { useAuth } from '../lib/auth-context';
import { useLanguage } from '../lib/language-context';
import { stashPendingGuestIntent } from '../lib/guest-booking-handoff';
import { GoogleSignInGate } from '../components/auth/GoogleSignInGate';
import { QueueStatusPanel } from '../components/QueueStatusPanel';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, SectionHeader, Button, Skeleton, InlineError } from '../components/ui';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'WalkInJoin'>;

export default function WalkInJoinScreen({ route }: Props) {
  const { salonId, services } = route.params;
  const { status, user } = useAuth();
  const { t } = useLanguage();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  // The shop needs to know who is in its queue and how to reach them. FastQue stores no customer
  // name, and a Google-sign-in account has no phone, so both are collected per join. The phone is
  // prefilled from the account when it has one.
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState(user?.phone ?? '');
  // A guest has no "mine" to check yet — skip straight past the loading state instead of firing
  // a request that would only 401.
  const [loading, setLoading] = useState(status === 'authenticated');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<QueueEntryDetailDto | null>(null);

  // A customer can only hold one active token anywhere — check for one on mount so a repeat
  // visit to this screen shows live status instead of a doomed join attempt. Guest visitors have
  // no active entry to find by definition (queue.service.ts's join endpoint requires auth), so
  // this is skipped entirely rather than firing a request that would only 401.
  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    apiFetch<QueueEntryDetailDto | null>(`${QUEUE_ENTRIES_PATH}/mine/active`)
      .then((active) => {
        if (!cancelled) setEntry(active);
      })
      .catch(() => {
        /* no active entry, or a transient error — the join button remains available */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (user?.phone) setContactPhone((current) => current || (user.phone as string));
  }, [user?.phone]);

  async function handleJoin() {
    const name = normalizeContactName(contactName);
    if (!name) {
      setError(t.contactNameRequiredError);
      return;
    }
    const phone = normalizeContactPhone(contactPhone);
    if (!phone) {
      setError(t.contactPhoneInvalidError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.join}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({
          ...(selectedServiceId ? { serviceId: selectedServiceId } : {}),
          contactName: name,
          contactPhone: phone,
        }),
      });
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotJoinQueue);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <Skeleton style={styles.loadingSkeleton} />
      </Screen>
    );
  }

  if (entry && entry.salonId !== salonId) {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader eyebrow={t.queueTitle} title={t.alreadyInQueueTitle} />
        <Text style={styles.subtitle}>
          {t.alreadyInQueueHint}
        </Text>
      </Screen>
    );
  }

  if (entry) {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader eyebrow={t.queueTitle} title={t.youreInLineTitle} />
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow={t.liveQueue} title={t.joinTheQueueTitle} subtitle={t.serviceOptional} />
      <View style={styles.serviceList}>
        <Pressable
          style={[styles.serviceOption, selectedServiceId === null && styles.serviceOptionSelected]}
          onPress={() => setSelectedServiceId(null)}
        >
          <Text style={styles.serviceOptionText}>{t.anyServiceOption}</Text>
        </Pressable>
        {services.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.serviceOption, selectedServiceId === s.id && styles.serviceOptionSelected]}
            onPress={() => setSelectedServiceId(s.id)}
          >
            <Text style={styles.serviceOptionText}>
              {s.name} ({s.durationMinutes} {t.minutesAbbrev})
            </Text>
          </Pressable>
        ))}
      </View>

      {status === 'authenticated' && (
        <View style={styles.contactBlock}>
          <Text style={styles.fieldLabel}>{t.contactNameLabel}</Text>
          <TextInput
            style={styles.input}
            value={contactName}
            onChangeText={setContactName}
            autoCapitalize="words"
            autoComplete="name"
            textContentType="name"
            maxLength={60}
            accessibilityLabel={t.contactNameLabel}
          />
          <Text style={styles.fieldLabel}>{t.contactPhoneLabel}</Text>
          <TextInput
            style={styles.input}
            value={contactPhone}
            onChangeText={setContactPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            maxLength={20}
            accessibilityLabel={t.contactPhoneLabel}
          />
          <Text style={styles.fieldHint}>{t.contactPhoneHint}</Text>
        </View>
      )}

      {error && <InlineError message={error} />}

      {status === 'authenticated' ? (
        <Button title={t.joinQueue} onPress={() => void handleJoin()} loading={submitting} style={styles.actionButton} />
      ) : (
        // Issue 2 (mobile launch mission) — same deferred-auth gate as ConfirmBookingScreen; see
        // its own comment and lib/guest-booking-handoff.ts for why the params are stashed here.
        <GoogleSignInGate
          label={t.signInWithGoogle}
          onBeforeSignIn={() => stashPendingGuestIntent({ kind: 'walkIn', params: route.params })}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { padding: space[5] },
  loadingSkeleton: { height: 140, borderRadius: radius.lg },
  subtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, lineHeight: 20 },
  serviceList: { gap: space[2], marginBottom: space[4] },
  serviceOption: {
    backgroundColor: '#ffffff',
    borderRadius: radius.sm,
    padding: space[4],
    borderWidth: 1,
    borderColor: color.border,
  },
  serviceOptionSelected: { borderColor: color.accent },
  serviceOptionText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink },
  actionButton: { marginTop: space[2] },
  contactBlock: { marginBottom: space[3] },
  fieldLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink, marginTop: space[3], marginBottom: space[1] },
  fieldHint: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },
  input: {
    minHeight: 48,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    color: color.ink,
  },
});
