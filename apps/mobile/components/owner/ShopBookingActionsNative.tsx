import { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { shopCancelBookingSchema, telHrefFor, type InvoiceDetailDto, type OwnerBookingDetailDto, type ShopCancelBookingResultDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { CANCELLATION_ACTOR_LABEL, describeCancellationNotice, ownerOpsPaths } from '../../lib/owner/ops';
import { color, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { Button, InlineError } from '../ui';

/**
 * What the shop can do with one booking: call the customer, move it to another real free time,
 * cancel it (the customer is told THE SHOP cancelled it, and the owner is told whether that message
 * reached them), or - once the service is done - invoice it. Every action is also enforced on the
 * server; this only decides what to offer.
 */
export function ShopBookingActionsNative({
  booking,
  onChanged,
  onReschedule,
  onOpenInvoice,
}: {
  booking: OwnerBookingDetailDto;
  onChanged: () => void;
  onReschedule: (booking: OwnerBookingDetailDto) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}) {
  const salonId = booking.salonId;
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<{ id: string; number: string } | null>(null);
  const [attemptKey, setAttemptKey] = useState(() => newIdempotencyKey());

  const live = booking.status === 'CONFIRMED' || booking.status === 'PENDING_PAYMENT';
  const phone = booking.customerPhone ?? booking.guestPhone ?? null;
  const telHref = telHrefFor(phone);

  async function cancel() {
    setError(null);
    const parsed = shopCancelBookingSchema.safeParse({ ...(reason.trim() ? { reason: reason.trim() } : {}) });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the reason and try again.');
      return;
    }
    setBusy('cancel');
    try {
      const result = await apiFetch<ShopCancelBookingResultDto>(ownerOpsPaths.cancelBooking(salonId, booking.id), {
        method: 'POST',
        headers: { 'Idempotency-Key': attemptKey },
        body: JSON.stringify(parsed.data),
      });
      setCancelling(false);
      setReason('');
      setNotice(describeCancellationNotice(result));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel this appointment. Nothing was changed.');
      setAttemptKey(newIdempotencyKey());
    } finally {
      setBusy(null);
    }
  }

  async function createInvoice() {
    setBusy('invoice');
    setError(null);
    try {
      const made = await apiFetch<InvoiceDetailDto>(ownerOpsPaths.invoices(salonId), {
        method: 'POST',
        headers: { 'Idempotency-Key': newIdempotencyKey() },
        body: JSON.stringify({ bookingId: booking.id }),
      });
      setInvoice({ id: made.id, number: made.number });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the invoice.');
    } finally {
      setBusy(null);
    }
  }

  async function callCustomer() {
    if (!telHref) return;
    try {
      await Linking.openURL(telHref);
    } catch {
      setError('Could not open the phone dialler.');
    }
  }

  return (
    <View style={styles.wrap}>
      {booking.status === 'CANCELLED' && (
        <Text style={styles.meta}>
          {`Cancelled by ${booking.cancelledByActor ? CANCELLATION_ACTOR_LABEL[booking.cancelledByActor].toLowerCase() : 'not recorded (older booking)'}${booking.cancellationReason ? ` · reason: “${booking.cancellationReason}”` : ''}`}
        </Text>
      )}
      {notice && <Text style={styles.notice} testID="booking-notice">{notice}</Text>}
      {error && <InlineError message={error} />}

      {!cancelling && (
        <View style={styles.row}>
          {telHref && <Button title="Call customer" variant="outline" onPress={() => void callCustomer()} style={styles.action} />}
          {live && <Button title="Reschedule" variant="outline" onPress={() => onReschedule(booking)} style={styles.action} />}
          {live && <Button title="Cancel appointment" variant="outline" onPress={() => setCancelling(true)} style={styles.action} />}
          {booking.status === 'COMPLETED' &&
            (invoice ? (
              onOpenInvoice ? (
                <Button title={`View invoice ${invoice.number}`} variant="outline" onPress={() => onOpenInvoice(invoice.id)} style={styles.action} />
              ) : (
                <Text style={styles.meta}>Invoice {invoice.number} created.</Text>
              )
            ) : (
              <Button title="Create invoice" variant="outline" onPress={() => void createInvoice()} loading={busy === 'invoice'} style={styles.action} />
            ))}
        </View>
      )}

      {cancelling && (
        <View style={styles.cancelBox} testID="cancel-box">
          <Text style={styles.cancelTitle}>Cancel this appointment?</Text>
          <Text style={styles.meta}>The customer is notified that the shop cancelled it. Tell them why (optional).</Text>
          <TextInput
            testID="cancel-reason"
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            maxLength={300}
            placeholder="Reason (optional)"
            placeholderTextColor={color.muted}
            accessibilityLabel="Cancellation reason"
          />
          <View style={styles.row}>
            <Button title="Cancel appointment and notify" onPress={() => void cancel()} loading={busy === 'cancel'} style={styles.action} />
            <Button title="Keep appointment" variant="outline" onPress={() => setCancelling(false)} style={styles.action} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[2] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] },
  action: { flexGrow: 1 },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, lineHeight: lineHeightFor(fontSize.xs), color: color.muted, marginTop: space[1] },
  notice: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: color.ink, marginTop: space[1] },
  cancelBox: { marginTop: space[2], padding: space[3], borderWidth: 1, borderColor: color.border, borderRadius: radius.sm },
  cancelTitle: { fontFamily: font.bodyBold, fontSize: fontSize.sm, color: color.ink },
  input: { minHeight: 44, marginTop: space[2], borderWidth: 1, borderColor: color.border, borderRadius: radius.sm, paddingHorizontal: space[3], fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink },
});
