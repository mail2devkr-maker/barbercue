import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, type StaffStatusDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import { LiveQueuePanel } from '../../components/dashboard/LiveQueuePanel';

function meePath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.staff}/${DASHBOARD_PATHS.me}`;
}

function statusPath(staffId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.staff}/${staffId}/${DASHBOARD_PATHS.status}`;
}

// Self clock-in/out: resolves "which SalonStaff row is me at this salon" via the new
// dashboard/salons/:salonId/staff/me lookup, then reuses the existing self-status PATCH
// (staff-status.service.ts already lets a SALON_STAFF update their own row with no owner check).
function SelfStatusCard({ salonId }: { salonId: string }) {
  const [me, setMe] = useState<StaffStatusDto | null | undefined>(undefined);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiFetch<StaffStatusDto | null>(meePath(salonId))
        .then((result) => {
          if (!cancelled) setMe(result);
        })
        .catch(() => {
          if (!cancelled) setMe(null);
        });
      return () => {
        cancelled = true;
      };
    }, [salonId]),
  );

  async function toggle() {
    if (!me) return;
    setUpdating(true);
    setError(null);
    try {
      const next = me.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const updated = await apiFetch<StaffStatusDto>(statusPath(me.id), {
        method: 'PATCH',
        body: JSON.stringify({ status: next }),
      });
      setMe(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update your status.');
    } finally {
      setUpdating(false);
    }
  }

  if (me === undefined) {
    return (
      <View style={styles.selfCard}>
        <ActivityIndicator color={color.muted} />
      </View>
    );
  }
  // Not on this salon's barber roster (e.g. an owner-only account viewing) — nothing to toggle.
  if (me === null) return null;

  return (
    <View style={styles.selfCard}>
      <View>
        <Text style={styles.selfLabel}>You&apos;re {me.status === 'ACTIVE' ? 'clocked in' : 'clocked out'}</Text>
        {error && <InlineError message={error} />}
      </View>
      <Button
        title={me.status === 'ACTIVE' ? 'Clock out' : 'Clock in'}
        variant={me.status === 'ACTIVE' ? 'outline' : 'primary'}
        onPress={() => void toggle()}
        loading={updating}
      />
    </View>
  );
}

// Same queue data and actions as Owner's Queue tab (see LiveQueuePanel's own doc comment for why
// — the backend authorizes staff and owner identically here). What staff does NOT get is a
// Dashboard tab (shop open/close) or a Shop tab (services/chairs/staff/hours management) — those
// stay owner-only by simply not existing in StaffNavigator's tab set.
export default function StaffTodayScreen() {
  const { workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon } = useSalon();

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false}>
        <InlineError message={error} />
      </Screen>
    );
  }
  if (workplaces.length === 0) {
    return (
      <Screen scroll={false}>
        <EmptyState title="No shop yet" message="Ask your shop owner to add you as staff on the BarberCue web dashboard." />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader eyebrow="Today" title={selectedSalon?.name ?? "Today's queue"} />

      {workplaces.length > 1 && (
        <View style={styles.pickerRow}>
          {workplaces.map((w) => (
            <Pressable
              key={w.id}
              style={[styles.pickerChip, w.id === selectedSalonId && styles.pickerChipActive]}
              onPress={() => selectSalon(w.id)}
            >
              <Text style={[styles.pickerChipText, w.id === selectedSalonId && styles.pickerChipTextActive]}>{w.name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {selectedSalonId && <SelfStatusCard salonId={selectedSalonId} />}
      {selectedSalonId && <LiveQueuePanel salonId={selectedSalonId} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 140, borderRadius: radius.lg },
  pickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  pickerChip: { paddingVertical: space[2], paddingHorizontal: space[3], borderRadius: radius.pill, borderWidth: 1, borderColor: color.border },
  pickerChipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pickerChipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, color: color.muted },
  pickerChipTextActive: { color: color.accent },
  selfCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.lg,
    padding: space[4],
    marginBottom: space[4],
  },
  selfLabel: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
