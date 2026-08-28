import { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, SalonSetupErrorCode, SalonStatus, type SalonStatusResultDto, type SalonSetupReadinessDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { color, font, fontSize, radius, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, EmptyState, Skeleton, InlineError } from '../../components/ui';
import type { OwnerTabParamList } from '../../navigation/OwnerNavigator';

// Salon status is read from SalonWorkplaceDto (via useSalon) rather than re-fetched here — the
// workplaces list already carries it, and PATCH .../status returns the fresh value which this
// screen applies locally, matching the pattern the rest of the app uses (no redundant re-fetch).
export default function OwnerDashboardScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<OwnerTabParamList>>();
  const { workplaces, loading, error, selectedSalonId, selectedSalon, selectSalon, reload } = useSalon();
  const [status, setStatus] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<SalonSetupReadinessDto | null>(null);

  useFocusEffect(
    useCallback(() => {
      setStatus(selectedSalon?.status ?? null);
      setReadiness(null);
      setActionError(null);
    }, [selectedSalon]),
  );

  async function toggleStatus(next: 'ACTIVE' | 'SUSPENDED') {
    if (!selectedSalonId) return;
    setUpdating(true);
    setActionError(null);
    setReadiness(null);
    try {
      const result = await apiFetch<SalonStatusResultDto>(
        `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${selectedSalonId}/${DASHBOARD_PATHS.status}`,
        { method: 'PATCH', body: JSON.stringify({ status: next }) },
      );
      setStatus(result.status);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.code === SalonSetupErrorCode.SALON_SETUP_INCOMPLETE) {
        setReadiness((err.details as SalonSetupReadinessDto | undefined) ?? null);
        setActionError(err.message);
      } else {
        setActionError(err instanceof ApiError ? err.message : 'Could not update shop status.');
      }
    } finally {
      setUpdating(false);
    }
  }

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
        <EmptyState title="No shops yet" message="Register a shop on the BarberCue web dashboard to manage it here." />
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader eyebrow="Owner" title="Dashboard" />

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

      {selectedSalon && (
        <Card style={styles.card}>
          <Text style={styles.salonName}>{selectedSalon.name}</Text>
          <Text style={styles.salonStatus}>Status: {status ?? selectedSalon.status}</Text>

          {actionError && <InlineError message={actionError} />}
          {readiness && (
            <View style={styles.readinessList}>
              <Text style={styles.readinessItem}>{readiness.hasActiveService ? '✓' : '○'} Active service</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveChair ? '✓' : '○'} Active chair</Text>
              <Text style={styles.readinessItem}>{readiness.hasActiveStaff ? '✓' : '○'} Active barber</Text>
            </View>
          )}

          {(status ?? selectedSalon.status) === SalonStatus.ACTIVE ? (
            <Button title="Close shop" variant="secondary" onPress={() => void toggleStatus('SUSPENDED')} loading={updating} style={styles.actionButton} />
          ) : (
            <Button title="Open shop" onPress={() => void toggleStatus('ACTIVE')} loading={updating} style={styles.actionButton} />
          )}
        </Card>
      )}

      <View style={styles.quickLinks}>
        <Pressable style={styles.quickLink} onPress={() => navigation.navigate('OwnerQueueTab')}>
          <Text style={styles.quickLinkText}>Live queue</Text>
        </Pressable>
        <Pressable style={styles.quickLink} onPress={() => navigation.navigate('OwnerShopTab')}>
          <Text style={styles.quickLinkText}>Manage shop</Text>
        </Pressable>
      </View>
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
  card: { marginBottom: space[4] },
  salonName: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink },
  salonStatus: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.muted, marginTop: space[1], marginBottom: space[3] },
  readinessList: { marginBottom: space[3] },
  readinessItem: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginBottom: 2 },
  actionButton: { marginTop: space[1] },
  quickLinks: { gap: space[2] },
  quickLink: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, padding: space[4] },
  quickLinkText: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
});
