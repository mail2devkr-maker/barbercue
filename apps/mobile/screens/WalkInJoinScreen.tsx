import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { QUEUE_ENTRIES_PATH, SALON_QUEUE_PATHS, type QueueEntryDetailDto } from '@barbercue/shared';
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
  const { status } = useAuth();
  const { t } = useLanguage();
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
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

  async function handleJoin() {
    setSubmitting(true);
    setError(null);
    try {
      const created = await apiFetch<QueueEntryDetailDto>(`salons/${salonId}/queue/${SALON_QUEUE_PATHS.join}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify(selectedServiceId ? { serviceId: selectedServiceId } : {}),
      });
      setEntry(created);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not join the queue. Please try again.');
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
        <SectionHeader eyebrow="Queue" title="Already in a queue" />
        <Text style={styles.subtitle}>
          You already have an active queue token at another salon. Finish or cancel it before joining here.
        </Text>
      </Screen>
    );
  }

  if (entry) {
    return (
      <Screen scroll={false} contentStyle={styles.screenContent}>
        <SectionHeader eyebrow="Queue" title="You're in line" />
        <QueueStatusPanel entry={entry} onEntryChange={setEntry} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <SectionHeader eyebrow="Live queue" title="Join the queue" subtitle="Service (optional)" />
      <View style={styles.serviceList}>
        <Pressable
          style={[styles.serviceOption, selectedServiceId === null && styles.serviceOptionSelected]}
          onPress={() => setSelectedServiceId(null)}
        >
          <Text style={styles.serviceOptionText}>Any service</Text>
        </Pressable>
        {services.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.serviceOption, selectedServiceId === s.id && styles.serviceOptionSelected]}
            onPress={() => setSelectedServiceId(s.id)}
          >
            <Text style={styles.serviceOptionText}>
              {s.name} ({s.durationMinutes} min)
            </Text>
          </Pressable>
        ))}
      </View>

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
});
