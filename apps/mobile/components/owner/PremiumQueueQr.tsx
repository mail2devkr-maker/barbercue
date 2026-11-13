import { useEffect, useRef, useState } from 'react';
import { Image, Share, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import { hasTurboNativeModule } from '../../lib/native-availability';

// react-native-view-shot resolves its TurboModule at import time, so it is loaded only on a binary
// that contains it (OTA safety, see lib/native-availability.ts).
function loadCaptureRef(): typeof import('react-native-view-shot').captureRef | null {
  if (!hasTurboNativeModule('RNViewShot')) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native-view-shot') as typeof import('react-native-view-shot')).captureRef;
  } catch {
    return null;
  }
}
import { DASHBOARD_PATHS, type PublicQueueQrDto, type SalonProfileDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import {
  formatQueueQrPrintAddress,
  gradientCharacters,
  QR_BG,
  QR_CENTER_EXCAVATION,
  QR_GOLD,
  QR_MAGENTA,
  QR_MUTED,
  QR_TEXT,
  queueQrFileName,
  trustedQueueUrl,
} from '../../lib/queue-qr-premium';
import { color, font, fontSize, space } from '../../lib/theme';
import { Button, Card, InlineError } from '../ui';
import { QrMatrixView } from './QrMatrixView';

const LOGO = require('../../assets/brand/fastque-clean-lockup.png');
const MARK = require('../../assets/brand/fastque-clean-mark.png');

type Action = 'image' | 'link' | null;

/**
 * Website parity for the premium "Customer Queue QR" (apps/web/components/dashboard/QueueQrSection.tsx):
 * the same server queue link (GET dashboard/salons/:id/queue-qr) drawn as the FastQue 4×6 stand —
 * gold QR on black, magenta frame, FastQue mark, gradient shop name and the saved shop address.
 * "Save / share poster" captures exactly what is on screen as a PNG.
 */
export function PremiumQueueQr({ salonId, salonName, hindi }: { salonId: string; salonName: string; hindi: boolean }) {
  const [queueUrl, setQueueUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(true);
  const [action, setAction] = useState<Action>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const posterRef = useRef<View>(null);

  useEffect(() => {
    let cancelled = false;
    const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
    setQueueUrl(null);
    setError(null);
    setAddress(null);
    setAddressLoading(true);
    apiFetch<PublicQueueQrDto>(`${base}/${DASHBOARD_PATHS.queueQr}`)
      .then((dto) => {
        if (cancelled) return;
        const url = trustedQueueUrl(dto?.publicQueueUrl);
        if (url) setQueueUrl(url);
        else setError(hindi ? 'क्यू QR लिंक उपलब्ध नहीं है।' : 'The queue QR link is not available.');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : hindi ? 'क्यू QR लोड नहीं हो सका।' : 'Could not load the queue QR.');
      });
    apiFetch<SalonProfileDetailDto>(`${base}/${DASHBOARD_PATHS.profile}`)
      .then((profile) => {
        if (!cancelled) setAddress(formatQueueQrPrintAddress(profile.addressLine ?? '', profile.postalCode ?? null) || null);
      })
      .catch(() => { if (!cancelled) setAddress(null); })
      .finally(() => { if (!cancelled) setAddressLoading(false); });
    return () => { cancelled = true; };
  }, [salonId, hindi]);

  async function savePoster() {
    if (!queueUrl || !posterRef.current) return;
    setAction('image'); setActionError(null); setNotice(null);
    try {
      const captureRef = loadCaptureRef();
      if (!captureRef) throw new Error('This app version cannot save the poster image. Update FastQue to save it.');
      const uri = await captureRef(posterRef, { format: 'png', quality: 1, result: 'tmpfile', fileName: queueQrFileName(salonName) });
      if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: salonName });
      setNotice(hindi ? 'QR पोस्टर सहेजने, प्रिंट करने या भेजने के लिए तैयार है।' : 'QR poster ready to save, print or send.');
    } catch {
      setActionError(hindi ? 'QR पोस्टर नहीं बन सका।' : 'Could not prepare the QR poster.');
    } finally {
      setAction(null);
    }
  }

  async function shareLink() {
    if (!queueUrl) return;
    setAction('link'); setActionError(null); setNotice(null);
    try {
      await Share.share({ message: queueUrl, url: queueUrl });
    } catch {
      setActionError(hindi ? 'लिंक साझा नहीं हो सका।' : 'Could not open the share sheet.');
    } finally {
      setAction(null);
    }
  }

  if (error) return <Card><Text style={styles.heading}>{hindi ? 'ग्राहक क्यू QR' : 'Customer Queue QR'}</Text><InlineError message={error} /></Card>;
  if (!queueUrl) return <Card><Text style={styles.heading}>{hindi ? 'ग्राहक क्यू QR' : 'Customer Queue QR'}</Text><Text style={styles.muted}>…</Text></Card>;

  return (
    <Card>
      <Text style={styles.heading}>{hindi ? 'ग्राहक क्यू QR' : 'Customer Queue QR'}</Text>
      <Text style={styles.muted}>{hindi ? 'ग्राहक दुकान पर यह QR स्कैन करके क्यू में जुड़ सकते हैं।' : 'Customers can scan this QR code at your shop to join the queue.'}</Text>
      <View ref={posterRef} collapsable={false} style={styles.poster} testID="premium-queue-qr">
        <Image source={LOGO} style={styles.logo} resizeMode="contain" accessibilityLabel="FastQue" />
        <Text style={styles.name} accessibilityLabel={salonName}>
          {gradientCharacters(salonName).map((part, i) => <Text key={i} style={{ color: part.color }}>{part.char}</Text>)}
        </Text>
        <Text style={styles.scan}>Scan to join the live queue</Text>
        <View style={styles.qrFrame}>
          <QrMatrixView
            value={queueUrl}
            label={`Join ${salonName} Live Queue QR code`}
            fgColor={QR_GOLD}
            bgColor={QR_BG}
            size={250}
            excavation={QR_CENTER_EXCAVATION}
            center={<Image source={MARK} style={styles.mark} resizeMode="contain" />}
          />
        </View>
        <Text style={styles.callout}>SCAN • JOIN • GET YOUR TURN</Text>
        <Text style={styles.powered}>Powered by FastQue</Text>
        {address ? <Text style={styles.address}>{address}</Text> : null}
      </View>
      <Text style={styles.hint}>{hindi ? 'सार्वजनिक क्यू लिंक' : 'Public queue URL'}</Text>
      <Text style={styles.url} selectable>{queueUrl}</Text>
      {!addressLoading && !address ? (
        <Text style={styles.hint}>{hindi ? 'दुकान का पता लोड नहीं हुआ। प्रोफ़ाइल में पता जाँचें।' : 'The shop address could not be loaded. Check the address in your shop profile before printing.'}</Text>
      ) : null}
      <Button title={hindi ? 'QR पोस्टर सहेजें / भेजें (PNG)' : 'Save / share QR poster (PNG)'} onPress={() => void savePoster()} loading={action === 'image'} disabled={action !== null || addressLoading || !address} style={styles.button} />
      <Button title={hindi ? 'क्यू लिंक साझा करें' : 'Share queue link'} variant="outline" onPress={() => void shareLink()} loading={action === 'link'} disabled={action !== null} style={styles.button} />
      {actionError ? <InlineError message={actionError} /> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontFamily: font.bodyBold, color: color.ink, fontSize: fontSize.base, marginBottom: space[1] },
  muted: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.sm, marginBottom: space[3] },
  poster: {
    alignSelf: 'center', width: '100%', maxWidth: 400, alignItems: 'center', gap: 10,
    backgroundColor: QR_BG, borderColor: QR_GOLD, borderWidth: 2, borderRadius: 22,
    paddingTop: 16, paddingBottom: 14, paddingHorizontal: 18,
  },
  logo: { width: 180, height: 53 },
  name: { fontFamily: font.bodyBold, fontSize: 24, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  scan: { fontFamily: font.bodyRegular, color: QR_TEXT, fontSize: 15, textAlign: 'center' },
  qrFrame: { padding: 10, borderWidth: 4, borderColor: QR_MAGENTA, backgroundColor: QR_BG, borderRadius: 16, alignItems: 'center' },
  mark: { width: '100%', height: '100%' },
  callout: { fontFamily: font.bodyBold, color: QR_MAGENTA, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  powered: { fontFamily: font.bodyRegular, color: QR_MUTED, fontSize: 12 },
  address: { fontFamily: font.bodyRegular, color: QR_MUTED, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  hint: { fontFamily: font.bodyRegular, color: color.muted, fontSize: fontSize.sm, marginTop: space[3] },
  url: { fontFamily: font.bodyRegular, color: color.ink, fontSize: fontSize.sm },
  button: { marginTop: space[3] },
  notice: { color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[3] },
});
