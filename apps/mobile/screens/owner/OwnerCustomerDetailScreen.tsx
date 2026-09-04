import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT,
  formatMoney,
  type CustomerLedgerEntryDto,
  type Language,
  type LedgerActionResultDto,
  type OwnerCustomerSummaryDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { color, font, fontSize, lineHeightFor, space } from '../../lib/theme';
import { Screen, SectionHeader, Card, Button, Skeleton, InlineError } from '../../components/ui';
import type { UiStrings } from '@barbercue/shared';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerCustomerDetail'>;

function segmentLabel(t: UiStrings, segment: string): string {
  const labels: Record<string, string> = { new: t.segmentNew, repeat: t.segmentRepeat, frequent: t.segmentFrequent };
  return labels[segment] ?? segment;
}

function customerPath(salonId: string, customerId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.customers}/${customerId}`;
}

function ledgerActionPath(salonId: string, customerId: string, ledgerEntryId: string, action: 'waive' | 'restore'): string {
  const verb = action === 'waive' ? DASHBOARD_PATHS.waive : DASHBOARD_PATHS.restore;
  return `${customerPath(salonId, customerId)}/${DASHBOARD_PATHS.ledger}/${ledgerEntryId}/${verb}`;
}

function formatDate(iso: string | null, language: Language): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(dateLocaleFor(language), { year: 'numeric', month: 'short', day: 'numeric' });
}

function reasonLabel(t: UiStrings, reason: string): string {
  return reason === 'NO_SHOW_CHARGE' ? t.noShowDueReason : t.cancellationChargeReason;
}

/**
 * Issue 1 (Manage Shop parity) — mobile equivalent of the web owner customer detail page built
 * for the Customer Dues + Cancellation Policy mission, reusing the exact same
 * DashboardCustomersService contract (getOne + waive/restore). Never re-derives eligibility or
 * amounts locally — backend stays authoritative, this only renders what it returns.
 */
export default function OwnerCustomerDetailScreen({ route }: Props) {
  const { customerId } = route.params;
  const { selectedSalonId } = useSalon();
  const { t, language } = useLanguage();
  const [summary, setSummary] = useState<OwnerCustomerSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ entry: CustomerLedgerEntryDto; action: 'waive' | 'restore' } | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!selectedSalonId) return;
    setLoading(true);
    setError(null);
    apiFetch<OwnerCustomerSummaryDto>(customerPath(selectedSalonId, customerId))
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t.couldNotLoadCustomer))
      .finally(() => setLoading(false));
  }, [selectedSalonId, customerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function applyLedgerResult(result: LedgerActionResultDto) {
    setSummary((prev) => {
      if (!prev) return prev;
      const ledgerEntries = prev.ledgerEntries.map((e) => (e.id === result.ledgerEntry.id ? result.ledgerEntry : e));
      const outstandingTotalAmount = ledgerEntries
        .filter((e) => e.status === 'OUTSTANDING')
        .reduce((sum, e) => sum + e.amount, 0);
      return { ...prev, ledgerEntries, outstandingTotalAmount };
    });
  }

  async function confirmPendingAction() {
    if (!pendingAction || !selectedSalonId) return;
    setActionSubmitting(true);
    setActionError(null);
    try {
      const result = await apiFetch<LedgerActionResultDto>(
        ledgerActionPath(selectedSalonId, customerId, pendingAction.entry.id, pendingAction.action),
        { method: 'POST' },
      );
      applyLedgerResult(result);
      setPendingAction(null);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : pendingAction.action === 'waive'
            ? t.couldNotWaiveDue
            : t.couldNotRestoreDue,
      );
    } finally {
      setActionSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.skeleton} />
      </Screen>
    );
  }
  if (error || !summary) {
    return (
      <Screen scroll={false}>
        <InlineError message={error ?? t.customerNotFound} />
      </Screen>
    );
  }

  const currency = summary.currency;
  const graceStatus = summary.newCustomerGraceEligible
    ? `${t.graceEligiblePrefix}${summary.completedCount}${t.graceEligibleMiddle}${NEW_CUSTOMER_GRACE_COMPLETED_VISIT_LIMIT}${t.graceEligibleSuffix}`
    : `${t.graceCompletedPrefix}${summary.completedCount}${t.graceCompletedSuffix}`;

  return (
    <Screen>
      <SectionHeader eyebrow={t.ownerEyebrow} title={summary.phone ?? summary.email ?? t.noContactOnFile} subtitle={graceStatus} />

      <Text style={styles.statsLine}>
        {summary.completedCount} {t.statusCompleted} · {summary.cancelledCount} {t.statusCancelled} · {summary.noShowCount} {t.statusNoShow}
        {summary.segment && ` · ${segmentLabel(t, summary.segment)}${t.customerSuffix}`}
      </Text>

      {summary.outstandingTotalAmount > 0 && (
        <Card style={styles.warningCard}>
          <Text style={styles.warningText}>
            {t.outstandingBlockedPrefix}{formatMoney(summary.outstandingTotalAmount, currency)}{t.outstandingBlockedSuffix}
          </Text>
        </Card>
      )}

      <Text style={styles.sectionTitle}>{t.duesTitle}</Text>
      {summary.ledgerEntries.length === 0 ? (
        <Text style={styles.emptyText}>{t.noDuesYet}</Text>
      ) : (
        summary.ledgerEntries.map((entry) => {
          const eligibleToWaive = entry.status === 'OUTSTANDING' && entry.reason === 'NO_SHOW_CHARGE' && summary.newCustomerGraceEligible;
          return (
            <Card key={entry.id} style={styles.dueCard}>
              <View style={styles.dueHeadRow}>
                <Text style={styles.dueTitle}>
                  {reasonLabel(t, entry.reason)} · {formatMoney(entry.amount, currency)}
                </Text>
                <Text style={[styles.statusBadge, entry.status === 'OUTSTANDING' ? styles.statusOutstanding : styles.statusWaived]}>
                  {entry.status === 'OUTSTANDING' ? t.outstandingBadge : t.waivedBadge}
                </Text>
              </View>
              <Text style={styles.dueMeta}>
                {entry.bookingServiceName ? `${entry.bookingServiceName} · ` : ''}
                {entry.bookingSlotStart ? formatDate(entry.bookingSlotStart, language) : t.noRelatedBooking}
              </Text>
              <Text style={styles.dueMeta}>{t.recordedPrefix}{formatDate(entry.createdAt, language)}</Text>
              {entry.status === 'OUTSTANDING' && entry.reason === 'NO_SHOW_CHARGE' && (
                <Button
                  title={t.waiveNoShowDueAction}
                  variant="outline"
                  disabled={!eligibleToWaive}
                  onPress={() => { setActionError(null); setPendingAction({ entry, action: 'waive' }); }}
                  style={styles.dueAction}
                />
              )}
              {entry.status === 'WAIVED' && (
                <Button
                  title={t.restoreDueRowAction}
                  variant="outline"
                  onPress={() => { setActionError(null); setPendingAction({ entry, action: 'restore' }); }}
                  style={styles.dueAction}
                />
              )}
            </Card>
          );
        })
      )}

      <Modal visible={pendingAction !== null} transparent animationType="fade" onRequestClose={() => setPendingAction(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {pendingAction && (
              <Text style={styles.modalText}>
                {pendingAction.action === 'waive'
                  ? `${t.waiveConfirmPrefix}${formatMoney(pendingAction.entry.amount, currency)}${t.waiveConfirmSuffix}`
                  : `${t.restoreConfirmPrefix}${formatMoney(pendingAction.entry.amount, currency)}${t.restoreConfirmSuffix}`}
              </Text>
            )}
            {actionError && <InlineError message={actionError} />}
            <View style={styles.modalActions}>
              <Button title={t.cancelAction} variant="outline" onPress={() => setPendingAction(null)} disabled={actionSubmitting} style={styles.modalButton} />
              <Button
                title={pendingAction?.action === 'waive' ? t.waiveDueAction : t.restoreDueModalAction}
                onPress={() => void confirmPendingAction()}
                loading={actionSubmitting}
                style={styles.modalButton}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 140, borderRadius: 12 },
  statsLine: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginBottom: space[4] },
  warningCard: { backgroundColor: color.goldSoft, marginBottom: space[4] },
  warningText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[3] },
  emptyText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted },
  dueCard: { marginBottom: space[3] },
  dueHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  dueTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, flex: 1, paddingRight: space[2] },
  statusBadge: {
    fontFamily: font.bodyBold,
    fontSize: 10,
    lineHeight: lineHeightFor(10),
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 999,
  },
  statusOutstanding: { color: '#8a5a00', backgroundColor: color.goldSoft },
  statusWaived: { color: color.muted, backgroundColor: '#f1ede2' },
  dueMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  dueAction: { marginTop: space[3], alignSelf: 'flex-start' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(20,16,12,0.45)', alignItems: 'center', justifyContent: 'center', padding: space[5] },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: space[5], width: '100%', maxWidth: 380 },
  modalText: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, color: color.ink, lineHeight: 20, marginBottom: space[3] },
  modalActions: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  modalButton: { flex: 1 },
});
