import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Share, StyleSheet, Text } from 'react-native';
import { DASHBOARD_PATHS, type SalonShareLinksDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { classifySalonShareLinks, type SalonShareResult } from '../../lib/qr-poster';
import { QrMatrixView } from '../../components/owner/QrMatrixView';
import { Button, Card, InlineError, Screen, SectionHeader } from '../../components/ui';
import { color, font, fontSize, space } from '../../lib/theme';

type LoadState =
  | { kind: 'loading'; salonId: string }
  | { kind: 'error'; salonId: string; message: string }
  | ({ salonId: string } & SalonShareResult);

type PosterAction = 'share' | null;

export default function OwnerQrPosterScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const [load, setLoad] = useState<LoadState | null>(null);
  const [retry, setRetry] = useState(0);
  const [action, setAction] = useState<PosterAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const hindi = language === 'HI';

  useFocusEffect(
    useCallback(() => {
      if (!selectedSalonId) return undefined;
      let active = true;
      const salonId = selectedSalonId;
      setLoad({ kind: 'loading', salonId });
      setActionError(null);
      setNotice(null);
      const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.shareLinks}`;

      void apiFetch<SalonShareLinksDto>(path)
        .then((dto) => {
          if (!active) return;
          setLoad({ ...classifySalonShareLinks(dto, salonId), salonId });
        })
        .catch((error: unknown) => {
          if (!active) return;
          setLoad({
            kind: 'error',
            salonId,
            message: error instanceof ApiError ? error.message : (hindi ? 'दुकान का QR लिंक लोड नहीं हो सका।' : 'Could not load the shop QR link.'),
          });
        });

      return () => { active = false; };
    }, [selectedSalonId, retry, hindi]),
  );

  const ready = load?.kind === 'ready' && load.salonId === selectedSalonId ? load : null;
  const name = ready?.salonName || selectedSalon?.name || (hindi ? 'आपकी दुकान' : 'Your shop');

  async function shareLink() {
    if (!ready) return;
    setAction('share');
    setActionError(null);
    setNotice(null);
    try {
      await Share.share({ message: `${ready.salonName} on FastQue\n${ready.publicUrl}`, url: ready.publicUrl });
      setNotice(hindi ? 'शेयर शीट खुल गई है।' : 'The share sheet opened.');
    } catch {
      setActionError(hindi ? 'दुकान का लिंक साझा नहीं हो सका।' : 'Could not open the shop link share sheet.');
    } finally {
      setAction(null);
    }
  }

  if (!selectedSalonId) {
    return <Screen><SectionHeader title={hindi ? 'दुकान का QR पोस्टर' : 'Shop QR poster'} />
      <Card><Text style={styles.body}>{hindi ? 'पहले दुकान चुनें।' : 'Select a shop first.'}</Text></Card>
    </Screen>;
  }

  if (!load || load.salonId !== selectedSalonId || load.kind === 'loading') {
    return <Screen><SectionHeader title={hindi ? 'दुकान का QR पोस्टर' : 'Shop QR poster'} />
      <Card><Text style={styles.body}>{hindi ? 'लिंक लोड हो रहा है…' : 'Loading the canonical shop link…'}</Text></Card>
    </Screen>;
  }

  return (
    <Screen>
      <SectionHeader title={hindi ? 'दुकान का QR पोस्टर' : 'Shop QR poster'} subtitle={hindi ? 'यह QR आपकी दुकान के सार्वजनिक FastQue पेज पर खुलेगा।' : 'This QR opens your shop’s canonical public FastQue page.'} />
      {load.kind === 'error' ? (
        <Card>
          <InlineError message={load.message} />
          <Button title={hindi ? 'फिर कोशिश करें' : 'Try again'} variant="outline" onPress={() => setRetry((value) => value + 1)} style={styles.button} />
        </Card>
      ) : load.kind === 'not-public' ? (
        <Card><Text style={styles.body}>{hindi ? 'दुकान सार्वजनिक रूप से खुलने के बाद QR पोस्टर उपलब्ध होगा।' : 'The QR poster is available after this shop is open to the public.'}</Text></Card>
      ) : load.kind === 'unavailable' ? (
        <Card><Text style={styles.body}>{hindi ? 'सार्वजनिक दुकान लिंक अभी उपलब्ध नहीं है। दुकान सेटिंग जाँचें और फिर प्रयास करें।' : 'A trusted public shop link is not available yet. Check shop settings and try again.'}</Text>
          <Button title={hindi ? 'फिर कोशिश करें' : 'Try again'} variant="outline" onPress={() => setRetry((value) => value + 1)} style={styles.button} />
        </Card>
      ) : (
        <>
          <Card style={styles.posterCard}>
            <Text style={styles.brand}>FASTQUE</Text>
            <Text style={styles.shopName}>{name}</Text>
            <Text style={styles.tagline}>{hindi ? 'बुक करने या लाइव क्यू में आने के लिए स्कैन करें' : 'Scan to book or join the Live Queue'}</Text>
            <QrMatrixView value={load.publicUrl} label={hindi ? `${name} का सार्वजनिक QR कोड` : `Public QR code for ${name}`} />
            <Text style={styles.callout}>{hindi ? 'SCAN • BOOK • SKIP THE WAIT' : 'SCAN • BOOK • SKIP THE WAIT'}</Text>
            <Text style={styles.powered}>Powered by FastQue</Text>
          </Card>
          <Card>
            <Text style={styles.body}>{load.publicUrl}</Text>
            <Button title={hindi ? 'दुकान QR लिंक साझा करें' : 'Share shop QR link'} onPress={() => void shareLink()} loading={action === 'share'} disabled={action !== null} style={styles.button} />
            <Text style={styles.note}>{hindi ? 'यह स्क्रीन सार्वजनिक दुकान लिंक का QR पूर्वावलोकन दिखाती है। शेयर से कोई संदेश अपने-आप नहीं भेजा जाता।' : 'This screen previews a QR for the public shop link. Sharing does not send messages automatically.'}</Text>
            {actionError ? <InlineError message={actionError} /> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
          </Card>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  posterCard: { alignItems: 'center', backgroundColor: '#171314', borderColor: '#ff3e57' },
  brand: { color: '#ff7190', fontFamily: font.bodyBold, fontSize: fontSize.lg, letterSpacing: 2 },
  shopName: { color: '#ffffff', fontFamily: font.bodyBold, fontSize: fontSize.xl, lineHeight: 30, textAlign: 'center', marginTop: space[2], maxWidth: '100%' },
  tagline: { color: '#f6dfe5', fontFamily: font.bodyRegular, fontSize: fontSize.sm, textAlign: 'center', marginTop: space[2], marginBottom: space[3] },
  callout: { color: '#ff7190', fontFamily: font.bodyBold, fontSize: fontSize.sm, letterSpacing: 0.5, textAlign: 'center', marginTop: space[3] },
  powered: { color: '#c9c3c4', fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[1] },
  body: { color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.base, lineHeight: 22 },
  note: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20, marginTop: space[3] },
  notice: { color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[3] },
  button: { marginTop: space[3] },
});
