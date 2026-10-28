import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { InvoiceDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { newIdempotencyKey } from '../../lib/idempotency';
import { ownerInvoiceByBookingRequestPath, ownerInvoiceIssueRequestPath } from '../../lib/owner-invoices';
import { color, font, fontSize, radius, space } from '../../lib/theme';

export function CompletedBookingInvoiceAction({ salonId, bookingId, language, onOpenInvoice }: {
  salonId: string;
  bookingId: string;
  language: string;
  onOpenInvoice: (invoiceId: string) => void;
}) {
  const isHindi = language === 'HI';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);

  const issue = () => {
    setBusy(true);
    setError(null);
    void apiFetch<InvoiceDetailDto>(ownerInvoiceIssueRequestPath(salonId), {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ bookingId }),
    }).then((invoice) => onOpenInvoice(invoice.id))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : (isHindi ? 'इनवॉइस जारी नहीं किया जा सका।' : 'Could not issue this invoice.')))
      .finally(() => setBusy(false));
  };

  const press = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    void apiFetch<InvoiceDetailDto | null>(ownerInvoiceByBookingRequestPath(salonId, bookingId))
      .then((existing) => {
        if (existing) {
          setBusy(false);
          onOpenInvoice(existing.id);
          return;
        }
        Alert.alert(
          isHindi ? 'इनवॉइस जारी करें?' : 'Issue an invoice?',
          isHindi
            ? 'यह पूरी हुई सेवा के दर्ज विवरण से इनवॉइस बनाएगा। भुगतान रिकॉर्ड नहीं होगा।'
            : 'The server will use the completed visit’s recorded details and configured billing profile. This does not record or collect a payment.',
          [
            { text: isHindi ? 'अभी नहीं' : 'Not now', style: 'cancel', onPress: () => setBusy(false) },
            { text: isHindi ? 'इनवॉइस जारी करें' : 'Issue invoice', onPress: issue },
          ],
        );
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : (isHindi ? 'इनवॉइस नहीं जाँचा जा सका।' : 'Could not check for an existing invoice.'));
        setBusy(false);
      });
  };

  return <View style={styles.wrap}>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={press} style={styles.button}>
      <Text style={styles.buttonText}>{busy ? (isHindi ? 'जाँच हो रही है…' : 'Checking…') : (isHindi ? 'इनवॉइस जारी करें' : 'Issue invoice')}</Text>
    </Pressable>
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrap: { marginTop: space[3], alignItems: 'flex-start', gap: space[2] },
  button: { minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3], borderWidth: 1, borderColor: color.accent, borderRadius: radius.sm },
  buttonText: { color: color.accent, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  error: { color: color.warn, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
});
