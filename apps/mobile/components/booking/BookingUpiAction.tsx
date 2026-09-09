import { useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { buildBookingUpiUri, canLaunchBookingUpi, UPI_FALLBACK_NOTICE, UPI_PAYMENT_NOTICE,
  type BookingDetailDto, type BookingPaymentInfoDto } from '@barbercue/shared';
import { newIdempotencyKey } from '../../lib/idempotency';
import { Button } from '../ui/Button';

/** Only mounted with a created booking. Returning from another app is NOT settlement evidence. */
export function BookingUpiAction({ booking, paymentInfo }: {
  booking: BookingDetailDto | null;
  paymentInfo: BookingPaymentInfoDto | null;
}) {
  const inFlight = useRef(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!booking || !['CONFIRMED', 'PENDING_PAYMENT'].includes(booking.status)
    || !paymentInfo?.onlinePaymentAvailable || !paymentInfo.paymentQrImageUrl) return null;

  async function pay() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpening(true);
    try {
      const uri = buildBookingUpiUri(booking, paymentInfo, newIdempotencyKey());
      if (!uri) { setNotice(UPI_FALLBACK_NOTICE); return; }
      setNotice(UPI_PAYMENT_NOTICE);
      // Direct ACTION_VIEW via Linking: Android selects a handler/default, without pinning a PSP.
      // Do not gate with canOpenURL: Android package visibility may report false without queries.
      await Linking.openURL(uri);
    } catch {
      setNotice(`Could not open a UPI app. ${UPI_FALLBACK_NOTICE}`);
    } finally {
      inFlight.current = false;
      setOpening(false);
    }
  }

  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      {canLaunchBookingUpi(booking, paymentInfo) && (
        <Button title="Tap to Pay with UPI" loading={opening} onPress={() => void pay()} />
      )}
      {paymentInfo.upiVpa && <Text selectable accessibilityLabel="Shop UPI ID">UPI ID: {paymentInfo.upiVpa}</Text>}
      {paymentInfo.upiPayeeName && <Text>Payee: {paymentInfo.upiPayeeName}</Text>}
      <Text accessibilityLiveRegion="polite">{notice ?? UPI_PAYMENT_NOTICE}</Text>
      <Text>{booking.payableAmount === 0 ? 'No amount is due for this booking. Do not send a UPI payment.' : UPI_FALLBACK_NOTICE}</Text>
    </View>
  );
}
