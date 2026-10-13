import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import {
  DASHBOARD_PATHS,
  Language,
  queuePhaseOf,
  telHrefFor,
  type AutoAssignResultDto,
  type ChairOptionDto,
  type DashboardQueueDto,
  type InvoiceDetailDto,
  type QueueEntryDetailDto,
  type StaffStatusDto,
} from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { getRealtimeSocket, joinSalonRoom, onReconnect } from '../../lib/realtime';
import { friendlyQueueActionError, liveQueuePaths, type LiveQueueAction } from '../../lib/live-queue-actions';
import { useLanguage } from '../../lib/language-context';
import { ownerOpsPaths } from '../../lib/owner/ops';
import { applySnapshot, describeAutoAssign, notYetAssigned, sectionsOf } from '../../lib/owner/queue-sections';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Card, Button, EmptyState, Skeleton, InlineError } from '../ui';
import { NewQueueCustomerSheet } from './NewQueueCustomerSheet';
import type { UiStrings } from '@barbercue/shared';

function dashboardBase(salonId: string): string {
  return ownerOpsPaths.queue(salonId);
}

/** While the realtime socket is down the board re-reads itself on this interval. */
const POLL_FALLBACK_MS = 15_000;

// Keyed by PHASE so an assigned customer (a CALLED entry that holds a barber) never reads as waiting for
// a barber or as already in service.
function statusLabel(t: UiStrings, entry: Pick<QueueEntryDetailDto, 'status' | 'assignedStaffId' | 'phase'>): string {
  const labels: Record<string, string> = {
    WAITING: t.waiting,
    CALLED: t.statusCalledShort,
    ASSIGNED: t.assignedNotStartedBadge,
    IN_SERVICE: t.inService,
    COMPLETED: t.statusCompleted,
    NO_SHOW: t.statusNoShow,
    CANCELLED: t.statusCancelled,
    EXPIRED: 'Expired',
  };
  const phase = queuePhaseOf(entry);
  return labels[phase] ?? phase;
}

// Booking/queue resource-reservation mission (Part 19) — the same derived, non-PII operational
// availability the web dashboard shows (Part 18), so this chip list stops presenting every
// ACTIVE-status barber as equally assignable. The assign POST remains the authority regardless —
// this is presentation only, matching the backend's own StaffStatusDto.availabilityState.
function staffAvailabilityLabel(s: StaffStatusDto, language: Language): string | null {
  if (s.availabilityState === 'RESERVED' && s.busyUntil) {
    return `Booked · ${new Date(s.busyUntil).toLocaleTimeString(language === Language.HI ? 'hi-IN' : 'en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (s.availabilityState === 'IN_SERVICE') return 'In service';
  if (s.availabilityState === 'RESERVED') return 'Booked';
  return null;
}

function EntryRow({
  entry,
  chairs,
  activeStaff,
  autoAssignEnabled,
  canStart,
  onAction,
  onNotice,
}: {
  entry: QueueEntryDetailDto;
  chairs: ChairOptionDto[];
  activeStaff: StaffStatusDto[];
  autoAssignEnabled?: boolean;
  /** The owner may start anyone's customer; a barber only their own (the server enforces it too). */
  canStart: boolean;
  onAction: () => void;
  onNotice: (message: string) => void;
}) {
  const { t, language } = useLanguage();
  const [assigning, setAssigning] = useState(false);
  // Part 7 — an appointment booked with a specific barber locks normal assignment to that barber
  // server-side (QueueErrorCode.APPOINTMENT_STAFF_LOCKED); pre-selecting it here means the common
  // case never even shows a choice that would just be rejected.
  const [staffId, setStaffId] = useState<string | null>(entry.preferredStaffId);
  const [chairId, setChairId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const staffOptions = entry.preferredStaffId
    ? activeStaff.filter((s) => s.id === entry.preferredStaffId)
    : activeStaff;

  const arrived = entry.arrivedAt !== null && entry.arrivedAt !== undefined;
  const telHref = telHrefFor(entry.customerPhone);

  async function run(action: LiveQueueAction, request: () => Promise<unknown>) {
    setSubmitting(action);
    setError(null);
    try {
      await request();
      setAssigning(false);
      onAction();
    } catch (err) {
      setError(friendlyQueueActionError(err, t, action));
      // A conflict means the list is stale (another operator acted first) - refresh to current truth.
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) onAction();
    } finally {
      setSubmitting(null);
    }
  }

  // Cancel / no-show / complete are final, so they always ask first.
  function confirmThen(title: string, body: string, actionLabel: string, proceed: () => void) {
    Alert.alert(title, body, [
      { text: t.keepEntryAction, style: 'cancel' },
      { text: actionLabel, style: 'destructive', onPress: proceed },
    ]);
  }

  function call() {
    return run('call', () => apiFetch(liveQueuePaths.call(entry.id), { method: 'POST' }));
  }
  function markArrived() {
    return run('arrive', () => apiFetch(liveQueuePaths.arrive(entry.id), { method: 'POST' }));
  }
  function noShow() {
    return run('noShow', () => apiFetch(liveQueuePaths.noShow(entry.id), { method: 'POST' }));
  }
  function cancel() {
    return run('cancel', () => apiFetch(liveQueuePaths.cancel(entry.id), { method: 'POST' }));
  }
  function confirmAssign() {
    if (!staffId || !chairId) return;
    return run('assign', () =>
      apiFetch(liveQueuePaths.assign(entry.id), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        // Assigning never starts the service: the barber (or the owner) presses Start service.
        body: JSON.stringify({ staffId, chairId, startService: false, ...(entry.serviceId ? { serviceId: entry.serviceId } : {}) }),
      }),
    );
  }
  // Reuses the server's one allocation engine (same locks, same checks as the manual assign above).
  function assignAutomatically() {
    return run('assign', async () => {
      await apiFetch(ownerOpsPaths.entryAutoAssign(entry.id), { method: 'POST' });
      onNotice(t.autoAssignedNotice.replace('{token}', String(entry.tokenNumber)));
    });
  }
  // The explicit start of service for an ASSIGNED customer.
  function startService() {
    return run('startService', async () => {
      await apiFetch(liveQueuePaths.startService(entry.id), { method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() } });
      onNotice(t.serviceStartedNotice);
    });
  }
  function complete() {
    const sessionId = entry.activeServiceSessionId;
    if (!sessionId) return;
    return run('complete', () => apiFetch(liveQueuePaths.complete(sessionId), { method: 'POST' }));
  }
  // A separate, explicit telephone action - deliberately NOT the queue-state "Call" above.
  async function phoneCustomer() {
    if (!telHref) return;
    setError(null);
    try {
      await Linking.openURL(telHref);
    } catch {
      setError(t.couldNotCompleteAction);
    }
  }

  const active = entry.status === 'WAITING' || entry.status === 'CALLED';
  const phase = queuePhaseOf(entry);
  const assignedNotStarted = phase === 'ASSIGNED';
  const staffChoiceBusy = (s: StaffStatusDto) => (s.availabilityState === 'RESERVED' || s.availabilityState === 'IN_SERVICE') && s.id !== entry.assignedStaffId;

  return (
    <Card style={styles.entryCard}>
      <View style={styles.entryHeaderRow}>
        <Text style={styles.token}>#{entry.tokenNumber}</Text>
        <Text style={styles.statusBadge} testID={`entry-status-${entry.tokenNumber}`}>{statusLabel(t, entry)}</Text>
      </View>

      <Text style={[styles.customerName, !entry.customerName && styles.customerMissing]}>
        {entry.customerName ?? t.customerNameMissing}
      </Text>
      <View style={styles.phoneRow}>
        <Text style={[styles.phoneText, !entry.customerPhone && styles.customerMissing]}>
          {entry.customerPhone ?? t.customerPhoneMissing}
        </Text>
        {telHref && (
          <Button title={t.phoneCustomerAction} variant="outline" onPress={() => void phoneCustomer()} style={styles.phoneButton} />
        )}
      </View>

      {entry.serviceName && <Text style={styles.meta}>{entry.serviceName}</Text>}
      {active && entry.status === 'WAITING' && entry.position ? (
        <Text style={styles.meta}>
          Position {entry.position} in line
          {entry.estimatedWaitMinutes !== null && entry.estimatedWaitMinutes !== undefined ? ` · about ${entry.estimatedWaitMinutes} min` : ''}
        </Text>
      ) : null}
      <Text style={[styles.arrivalState, arrived ? styles.arrivalYes : styles.arrivalNo]}>
        {arrived ? t.arrivedStatus : t.notYetArrivedStatus}
      </Text>
      {entry.assignedStaffName && (
        <Text style={styles.meta}>
          {`${assignedNotStarted ? `${t.assignedToLabel}: ` : ''}${entry.assignedStaffName}${entry.assignedChairLabel ? ` - ${entry.assignedChairLabel}` : ''}`}
        </Text>
      )}
      {assignedNotStarted && <Text style={styles.meta} testID={`service-not-started-${entry.tokenNumber}`}>{t.serviceNotStartedHint}</Text>}
      {entry.status === 'WAITING' && arrived && (
        <Text style={styles.meta} testID={`waiting-for-staff-${entry.tokenNumber}`}>
          {autoAssignEnabled === false ? t.waitingToBeAssigned : t.waitingForAvailableStaff}
        </Text>
      )}
      {entry.preferredStaffName && active ? <Text style={styles.meta}>Wants {entry.preferredStaffName}</Text> : null}
      {error && <InlineError message={error} />}

      {active && !arrived && (
        <Button title={t.markArrivedAction} onPress={() => void markArrived()} loading={submitting === 'arrive'} style={styles.fullButton} />
      )}

      {active && arrived && !assigning && !assignedNotStarted && (
        <Button title={t.assignAutomaticallyAction} onPress={() => void assignAutomatically()} loading={submitting === 'assign'} style={styles.fullButton} />
      )}

      {entry.status === 'WAITING' && (
        <View style={styles.actionRow}>
          <Button title={t.callAction} variant={arrived ? 'primary' : 'outline'} onPress={() => void call()} loading={submitting === 'call'} style={styles.actionButton} />
          <Button
            title={t.cancelAction}
            variant="outline"
            onPress={() => confirmThen(t.confirmCancelEntryTitle, t.confirmCancelEntryBody, t.cancelAction, () => void cancel())}
            loading={submitting === 'cancel'}
            style={styles.actionButton}
          />
        </View>
      )}

      {assignedNotStarted && !assigning && canStart && (
        <Button title={t.startServiceAction} onPress={() => void startService()} loading={submitting === 'startService'} style={styles.fullButton} />
      )}

      {entry.status === 'CALLED' && !assigning && (arrived || assignedNotStarted) && (
        <Button title={assignedNotStarted ? t.changeBarberChairAction : t.assignAction} variant={assignedNotStarted ? 'outline' : 'primary'} onPress={() => setAssigning(true)} style={styles.fullButton} />
      )}

      {entry.status === 'CALLED' && !assigning && (
        <View style={styles.actionRow}>
          <Button
            title={t.noShowAction}
            variant="outline"
            onPress={() => confirmThen(t.confirmNoShowEntryTitle, t.confirmNoShowEntryBody, t.noShowAction, () => void noShow())}
            loading={submitting === 'noShow'}
            style={styles.actionButton}
          />
          <Button
            title={t.cancelAction}
            variant="outline"
            onPress={() => confirmThen(t.confirmCancelEntryTitle, t.confirmCancelEntryBody, t.cancelAction, () => void cancel())}
            loading={submitting === 'cancel'}
            style={styles.actionButton}
          />
        </View>
      )}

      {entry.status === 'CALLED' && assigning && (
        <View style={styles.assignPanel}>
          <Text style={styles.assignLabel}>{t.barberLabel}</Text>
          {entry.preferredStaffId && (
            <Text style={styles.meta}>
              Booked with {entry.preferredStaffName ?? 'a specific barber'}. Use Reassign after check-in to change it.
            </Text>
          )}
          <View style={styles.chipRow}>
            {staffOptions.map((s) => {
              const busy = staffChoiceBusy(s);
              const label = s.id === entry.assignedStaffId ? null : staffAvailabilityLabel(s, language);
              return (
                <Pressable
                  key={s.id}
                  disabled={busy}
                  style={[styles.chip, staffId === s.id && styles.chipActive, busy && styles.chipDisabled]}
                  onPress={() => setStaffId(s.id)}
                >
                  <Text style={[styles.chipText, staffId === s.id && styles.chipTextActive]}>
                    {s.displayName}
                    {label ? ` · ${label}` : ''}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.assignLabel}>{t.chairLabel}</Text>
          <View style={styles.chipRow}>
            {chairs.filter((c) => (c.occupancy ?? 'FREE') === 'FREE' && (!c.reservedForEntryId || c.reservedForEntryId === entry.id)).map((c) => (
              <Pressable key={c.id} style={[styles.chip, chairId === c.id && styles.chipActive]} onPress={() => setChairId(c.id)}>
                <Text style={[styles.chipText, chairId === c.id && styles.chipTextActive]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.actionRow}>
            <Button
              title={t.confirmAssignmentAction}
              onPress={() => void confirmAssign()}
              loading={submitting === 'assign'}
              disabled={!staffId || !chairId}
              style={styles.actionButton}
            />
            <Button title={t.cancelAction} variant="outline" onPress={() => setAssigning(false)} style={styles.actionButton} />
          </View>
        </View>
      )}

      {entry.status === 'IN_SERVICE' && (
        <Button
          title={t.completeServiceAction}
          onPress={() => confirmThen(t.confirmCompleteServiceTitle, t.confirmCompleteServiceBody, t.completeServiceAction, () => void complete())}
          loading={submitting === 'complete'}
          style={styles.fullButton}
        />
      )}
    </Card>
  );
}

/** A finished or ended visit: read-only, with the invoice action for completed ones. */
function PastRow({
  entry,
  salonId,
  invoiceable,
  onOpenInvoice,
}: {
  entry: QueueEntryDetailDto;
  salonId: string;
  invoiceable: boolean;
  onOpenInvoice?: (invoiceId: string) => void;
}) {
  const { t } = useLanguage();
  const [invoice, setInvoice] = useState<{ id: string; number: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createInvoice() {
    setBusy(true);
    setError(null);
    try {
      // One ISSUED invoice per visit: creating again simply returns the existing one.
      const made = await apiFetch<InvoiceDetailDto>(ownerOpsPaths.invoices(salonId), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({ queueEntryId: entry.id }),
      });
      setInvoice({ id: made.id, number: made.number });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.pastCard}>
      <View style={styles.entryHeaderRow}>
        <Text style={styles.pastToken}>#{entry.tokenNumber}</Text>
        <Text style={styles.statusBadge}>{statusLabel(t, entry)}</Text>
      </View>
      <Text style={[styles.customerName, !entry.customerName && styles.customerMissing]}>{entry.customerName ?? `Customer #${entry.tokenNumber}`}</Text>
      <Text style={styles.meta}>
        {entry.serviceName ?? 'Service not chosen'}
        {entry.assignedStaffName ? ` · ${entry.assignedStaffName}` : ''}
        {entry.assignedChairLabel ? ` · ${entry.assignedChairLabel}` : ''}
      </Text>
      {error && <InlineError message={error} />}
      {invoiceable &&
        (invoice ? (
          onOpenInvoice ? (
            <Button title={`View invoice ${invoice.number}`} variant="outline" onPress={() => onOpenInvoice(invoice.id)} style={styles.fullButton} />
          ) : (
            <Text style={styles.meta}>Invoice {invoice.number} created.</Text>
          )
        ) : (
          <Button title="Create invoice" variant="outline" onPress={() => void createInvoice()} loading={busy} style={styles.fullButton} />
        ))}
    </Card>
  );
}

export interface LiveQueuePanelHandle {
  /** Issue 4 (mobile stabilization mission) — lets an ancestor's pull-to-refresh (a plain
   * <Screen refreshing/onRefresh>, which this panel does not render itself) trigger the same
   * refetch as focus/realtime already do, without duplicating this panel's own load logic. */
  refresh: () => Promise<void>;
}

export interface LiveQueuePanelProps {
  salonId: string;
  /** Owners also get the automatic-assignment switch; barbers share every other control. */
  role?: 'owner' | 'staff';
  /** Opens the "New Live Queue customer" sheet on first render (Dashboard quick action). */
  autoOpenNewCustomer?: boolean;
  onNewAppointment?: () => void;
  onOpenInvoice?: (invoiceId: string) => void;
  /** The signed-in barber's own staff id (staff role): they may start only the customer assigned to them. */
  myStaffId?: string | null;
}

/**
 * The live-queue board + operational actions, shared by Owner's Queue tab and Staff's Today tab — the
 * backend permits both roles identically (@Roles(SALON_STAFF, SALON_OWNER) on DashboardQueueController),
 * so there is no authorization reason to give them different queue UIs. What differs between the two
 * roles is which *other* tabs exist around this one — enforced by each navigator's own tab set.
 *
 * The board keeps four places a visit can be - Waiting, In service, Completed today, and the ended
 * history - and every visit is in exactly one of them.
 */
export const LiveQueuePanel = forwardRef<LiveQueuePanelHandle, LiveQueuePanelProps>(function LiveQueuePanel(
  { salonId, role = 'owner', autoOpenNewCustomer = false, onNewAppointment, onOpenInvoice, myStaffId = null },
  ref,
) {
  const { t } = useLanguage();
  const [data, setData] = useState<DashboardQueueDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [chairBusyId, setChairBusyId] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState<string | null>(null);
  const [showNewCustomer, setShowNewCustomer] = useState(autoOpenNewCustomer);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const hasDataRef = useRef(false);
  const dataRef = useRef<DashboardQueueDto | null>(null);

  // `silent` refreshes (after an operator action, on a realtime event, after a reconnect) keep the
  // list mounted. A non-silent load swaps the whole panel for skeletons, which remounts every card
  // and would wipe an in-progress assignment or the error message the owner is reading.
  const load = useCallback(
    (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      return apiFetch<DashboardQueueDto>(dashboardBase(salonId))
        .then((next) => {
          hasDataRef.current = true;
          const applied = applySnapshot(dataRef.current, next);
          dataRef.current = applied;
          setData(applied);
          setError(null);
        })
        .catch((err: unknown) => {
          // A failed background refresh must not replace a list the owner is already looking at.
          if (silent && hasDataRef.current) return;
          setError(err instanceof ApiError ? err.message : t.couldNotLoadQueue);
        })
        .finally(() => {
          if (!silent) setLoading(false);
        });
    },
    [salonId, t],
  );

  useImperativeHandle(ref, () => ({ refresh: () => load() }), [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (autoOpenNewCustomer) setShowNewCustomer(true);
  }, [autoOpenNewCustomer]);

  useEffect(() => {
    const socket = getRealtimeSocket();
    joinSalonRoom(salonId);
    function onUpdate(payload: { salonId: string }) {
      if (payload.salonId === salonId) void load(true);
    }
    // Every event that can move a customer between Waiting / Assigned / In service, or change who is
    // on duty, refreshes the board.
    const events = ['queue.updated', 'queue.entry.called', 'queue.entry.reassigned', 'queue.entry.no_show', 'queue.entry.expired', 'staff.status.changed'];
    events.forEach((name) => socket.on(name, onUpdate));
    const unsubscribeReconnect = onReconnect(() => void load(true)); // Phase 15: resync after reconnect
    // Polling fallback: if the socket is down the board still refreshes itself.
    const poll = setInterval(() => {
      if (!(socket as { connected?: boolean }).connected) void load(true);
    }, POLL_FALLBACK_MS);
    return () => {
      events.forEach((name) => socket.off(name, onUpdate));
      unsubscribeReconnect();
      clearInterval(poll);
    };
  }, [salonId, load]);

  // Legacy manual chair occupancy (set before the Live Queue replaced it) can still be released; new
  // "local customer" occupancy can no longer be created - a customer at the shop is a queue entry.
  async function freeLegacyChair(chair: ChairOptionDto) {
    setChairBusyId(chair.id);
    setError(null);
    try {
      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairOccupancy}/${chair.id}/${DASHBOARD_PATHS.freeLocal}`, { method: 'POST' });
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotCompleteAction);
    } finally {
      setChairBusyId(null);
    }
  }

  async function autoAssignAll() {
    setAutoBusy('all');
    setError(null);
    setNotice(null);
    try {
      const result = await apiFetch<AutoAssignResultDto>(ownerOpsPaths.queueAutoAssign(salonId), { method: 'POST' });
      setNotice(describeAutoAssign(result));
      await load(true);
    } catch (err) {
      setError(friendlyQueueActionError(err, t, 'assign'));
    } finally {
      setAutoBusy(null);
    }
  }

  async function setAutomatic(next: boolean) {
    setAutoBusy('setting');
    setError(null);
    try {
      await apiFetch(ownerOpsPaths.queueSettings(salonId), { method: 'PATCH', body: JSON.stringify({ autoAssignEnabled: next }) });
      await load(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.couldNotCompleteAction);
    } finally {
      setAutoBusy(null);
    }
  }

  if (loading) {
    return (
      <>
        <Skeleton style={styles.skeleton} />
        <Skeleton style={styles.skeleton} />
      </>
    );
  }
  if (error && !data) {
    return <InlineError message={error} />;
  }
  if (!data) {
    return <InlineError message={t.couldNotLoadQueue} />;
  }

  const activeStaff = data.staffRoster.filter((s) => s.status === 'ACTIVE');
  const sections = sectionsOf(data);
  const waiting = notYetAssigned(sections);
  const anyoneInShop = waiting.some((e) => e.arrivedAt !== null && e.arrivedAt !== undefined);
  // The owner starts anyone's customer; a barber only the one assigned to them.
  const canStartEntry = (entry: QueueEntryDetailDto) => role === 'owner' || (myStaffId !== null && entry.assignedStaffId === myStaffId);

  const toolbar = (
    <View style={styles.toolbar}>
      <Button title={t.newLiveQueueCustomerAction} onPress={() => setShowNewCustomer(true)} style={styles.toolbarButton} />
      {onNewAppointment && <Button title={t.newInShopAppointmentAction} variant="outline" onPress={onNewAppointment} style={styles.toolbarButton} />}
      {anyoneInShop && <Button title={t.assignAllAutomaticallyAction} variant="outline" onPress={() => void autoAssignAll()} loading={autoBusy === 'all'} style={styles.toolbarButton} />}
    </View>
  );

  const chairStatus = (
    <Card style={styles.entryCard}>
      <View style={styles.entryHeaderRow}><Text style={styles.token}>{t.chairStatusTitle}</Text></View>
      {data.chairs.length === 0 ? <Text style={styles.meta}>No chairs are set up yet.</Text> : null}
      {data.chairs.map((chair) => {
        const occupancy = chair.occupancy ?? 'FREE';
        return <View key={chair.id} style={styles.chairRow}>
          <View style={styles.chairText}>
            <Text style={styles.assignLabel}>{chair.label}</Text>
            <Text style={styles.meta}>
              {occupancy === 'FREE' && chair.reservedForEntryId
                ? `${t.chairReservedLabel} · #${chair.reservedForTokenNumber ?? '?'}`
                : occupancy === 'FREE'
                  ? t.chairFreeLabel
                  : occupancy === 'LOCAL'
                    ? t.chairOccupiedNotQueue
                    : t.chairOccupiedToken.replace('{token}', String(chair.tokenNumber ?? '?'))}
            </Text>
          </View>
          {occupancy === 'LOCAL' && <Button title="Free chair" variant="outline" onPress={() => void freeLegacyChair(chair)} loading={chairBusyId === chair.id} />}
        </View>;
      })}
    </Card>
  );

  const automatic = role === 'owner' && data.autoAssignEnabled !== undefined ? (
    <Card style={styles.entryCard}>
      <View style={styles.switchRow}>
        <View style={styles.chairText}>
          <Text style={styles.assignLabel}>{t.automaticAssignmentLabel}</Text>
          <Text style={styles.meta}>{t.automaticAssignmentHint}</Text>
        </View>
        <Switch testID="auto-assign-switch" value={data.autoAssignEnabled === true} onValueChange={(next) => void setAutomatic(next)} disabled={autoBusy === 'setting'} accessibilityLabel={t.automaticAssignmentLabel} />
      </View>
    </Card>
  ) : null;

  const nothingActive = waiting.length === 0 && sections.assigned.length === 0 && sections.inService.length === 0;
  const reload = () => void load(true);

  return (
    <>
      {toolbar}
      {notice && <Text style={styles.notice} testID="queue-notice">{notice}</Text>}
      {error && <InlineError message={error} />}
      {showNewCustomer && (
        <NewQueueCustomerSheet
          salonId={salonId}
          services={data.services}
          staff={activeStaff}
          onClose={() => setShowNewCustomer(false)}
          onCreated={(created) => {
            setShowNewCustomer(false);
            setNotice(`${created.customerName ?? 'Customer'} was added to the Live Queue as #${created.tokenNumber}.`);
            reload();
          }}
        />
      )}

      <Text style={styles.sectionTitle} testID="section-waiting">{t.queueSectionWaiting.replace('{count}', String(waiting.length))}</Text>
      {waiting.length === 0 ? <Text style={styles.empty}>{t.nobodyWaitingNote}</Text> : null}
      {waiting.map((entry) => (
        <EntryRow key={entry.id} entry={entry} chairs={data.chairs} activeStaff={activeStaff} autoAssignEnabled={data.autoAssignEnabled} canStart={false} onAction={reload} onNotice={setNotice} />
      ))}

      <Text style={styles.sectionTitle} testID="section-assigned">{t.queueSectionAssigned.replace('{count}', String(sections.assigned.length))}</Text>
      {sections.assigned.length === 0 ? <Text style={styles.empty}>{t.assignedSectionEmpty}</Text> : null}
      {sections.assigned.map((entry) => (
        <EntryRow key={entry.id} entry={entry} chairs={data.chairs} activeStaff={activeStaff} canStart={canStartEntry(entry)} onAction={reload} onNotice={setNotice} />
      ))}

      <Text style={styles.sectionTitle} testID="section-in-service">{t.queueSectionInService.replace('{count}', String(sections.inService.length))}</Text>
      {sections.inService.length === 0 ? <Text style={styles.empty}>{t.nobodyBeingServedNote}</Text> : null}
      {sections.inService.map((entry) => (
        <EntryRow key={entry.id} entry={entry} chairs={data.chairs} activeStaff={activeStaff} canStart={false} onAction={reload} onNotice={setNotice} />
      ))}

      {nothingActive && <EmptyState title={t.queueIsEmptyTitle} message={t.queueIsEmptyHint} />}

      {chairStatus}
      {automatic}

      <Pressable accessibilityRole="button" testID="toggle-completed" onPress={() => setShowCompleted((v) => !v)} style={styles.sectionToggle}>
        <Text style={styles.sectionTitle}>{`${t.queueSectionCompleted.replace('{count}', String(sections.completedToday.length))} ${showCompleted ? '▲' : '▼'}`}</Text>
      </Pressable>
      {showCompleted && (sections.completedToday.length === 0 ? <Text style={styles.empty}>No visits completed yet today.</Text> : sections.completedToday.map((entry) => <PastRow key={entry.id} entry={entry} salonId={salonId} invoiceable onOpenInvoice={onOpenInvoice} />))}

      <Pressable accessibilityRole="button" testID="toggle-history" onPress={() => setShowHistory((v) => !v)} style={styles.sectionToggle}>
        <Text style={styles.sectionTitle}>{`${t.queueSectionHistory.replace('{count}', String(sections.historyToday.length))} ${showHistory ? '▲' : '▼'}`}</Text>
      </Pressable>
      {showHistory && (sections.historyToday.length === 0 ? <Text style={styles.empty}>Nothing ended early today.</Text> : sections.historyToday.map((entry) => <PastRow key={entry.id} entry={entry} salonId={salonId} invoiceable={false} />))}
    </>
  );
});

const styles = StyleSheet.create({
  skeleton: { height: 100, borderRadius: radius.lg, marginBottom: space[3] },
  entryCard: { marginBottom: space[3] },
  pastCard: { marginBottom: space[2] },
  entryHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  token: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, lineHeight: lineHeightFor(fontSize.lg), color: color.ink },
  pastToken: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink },
  statusBadge: {
    fontFamily: font.bodyBold,
    fontSize: 11,
    lineHeight: lineHeightFor(11),
    letterSpacing: 0.5,
    color: color.gold,
    textTransform: 'uppercase',
  },
  customerName: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink, marginTop: space[1] },
  customerMissing: { color: color.muted, fontFamily: font.bodyRegular },
  phoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[2], marginTop: space[1] },
  phoneText: { flex: 1, fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink },
  phoneButton: { minWidth: 0 },
  arrivalState: { fontFamily: font.bodyBold, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), marginTop: space[1], textTransform: 'uppercase', letterSpacing: 0.4 },
  arrivalYes: { color: color.gold },
  arrivalNo: { color: color.muted },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.muted, marginTop: space[1] },
  actionRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  actionButton: { flex: 1 },
  fullButton: { marginTop: space[3] },
  assignPanel: { marginTop: space[3] },
  chairRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border },
  chairText: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  toolbar: { gap: space[2], marginBottom: space[3] },
  toolbarButton: { alignSelf: 'stretch' },
  notice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink, marginBottom: space[3] },
  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, lineHeight: lineHeightFor(fontSize.base), color: color.ink, marginTop: space[3], marginBottom: space[2] },
  sectionToggle: { minHeight: 44, justifyContent: 'center' },
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginBottom: space[2] },
  assignLabel: {
    fontFamily: font.bodySemiBold,
    fontSize: fontSize.xs,
    lineHeight: lineHeightFor(fontSize.xs),
    color: color.ink,
    marginBottom: space[2],
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[3] },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.border,
  },
  chipActive: { borderColor: color.accent, backgroundColor: color.accentSoft },
  // Part 19 — a reserved/in-service barber's chip reads as unavailable rather than an equally
  // pickable option; the assign POST still rejects it regardless if this is somehow bypassed.
  chipDisabled: { opacity: 0.5 },
  chipText: { fontFamily: font.bodyMedium, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted },
  chipTextActive: { color: color.accent },
});
