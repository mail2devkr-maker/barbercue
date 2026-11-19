import { Text as RNText, View, type TextProps } from 'react-native';
import { useThemeTokens } from '../../lib/theme-mode';
import { UPI_QR_ONLY_NOTICE, type SalonPaymentQrDto } from '@barbercue/shared';

/** Plain Text had no colour (black), unreadable in the dark theme: follow the theme's ink. */
function Text(props: TextProps) {
  const { color } = useThemeTokens();
  return <RNText {...props} style={[{ color: color.ink }, props.style]} />;
}

/** Read-only result of the existing native QR upload; no manual routing override. */
export function UpiRoutingStatus({ current }: {
  current: SalonPaymentQrDto | null;
}) {
  const detected = current?.paymentQrImageUrl && current.upiQrDecoded === true && current.upiVpa && current.upiPayeeName;
  return <View style={{ gap: 8, marginVertical: 16 }} accessibilityLiveRegion="polite">
    <Text>Direct UPI</Text>
    {!current?.paymentQrImageUrl ? <Text>Upload your shop UPI QR image. FastQue will detect its UPI account automatically.</Text>
      : detected ? <>
        <Text>QR uploaded successfully. UPI account detected.</Text>
        <Text selectable>UPI ID: {current.upiVpa}</Text>
        <Text>Payee: {current.upiPayeeName}</Text>
        <Text>Tap to Pay enabled. Check the detected account before accepting payments.</Text>
      </> : <Text>{UPI_QR_ONLY_NOTICE}</Text>}
  </View>;
}
