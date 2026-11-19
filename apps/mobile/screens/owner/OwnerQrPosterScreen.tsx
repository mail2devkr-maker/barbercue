import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Linking, Share, StyleSheet, Text, TextInput } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { qrMatrixToPng, toBase64 } from '../../lib/qr-png';
import { safeFileName } from '../../lib/api';
import { DASHBOARD_PATHS, type SalonShareLinksDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { classifySalonShareLinks, createQrMatrix, type SalonShareResult } from '../../lib/qr-poster';
import { QrMatrixView } from '../../components/owner/QrMatrixView';
import { PremiumQueueQr } from '../../components/owner/PremiumQueueQr';
import { Button, Card, InlineError, Screen, SectionHeader } from '../../components/ui';
import { color, font, fontSize, space } from '../../lib/theme';
import { useThemedStyles, type ThemeTokens } from '../../lib/theme-mode';

type LoadState =
  | { kind: 'loading'; salonId: string }
  | { kind: 'error'; salonId: string; message: string }
  | ({ salonId: string } & SalonShareResult);

type PosterAction = 'share' | 'image' | null;
const MESSAGE_MAX = 300;

export default function OwnerQrPosterScreen() {
  const styles = useThemedStyles(makeStyles);
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const [load, setLoad] = useState<LoadState | null>(null);
  const [retry, setRetry] = useState(0);
  const [action, setAction] = useState<PosterAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
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

  // Website parity (ShopSharePanel): the owner can edit the message sent with the link; the link
  // itself always comes from the server and is appended unchanged.
  const defaultMessage = ready ? (hindi ? `${ready.salonName} पर FastQue से बुक करें या लाइव क्यू में जुड़ें:` : `Book at ${ready.salonName} or join the Live Queue on FastQue:`) : '';
  const text = (message ?? defaultMessage).slice(0, MESSAGE_MAX);

  async function shareImage() {
    if (!ready) return;
    setAction('image');
    setActionError(null);
    setNotice(null);
    try {
      // Website parity: "Download QR (PNG)", encoded on the phone from the same canonical link.
      const uri = `${FileSystem.cacheDirectory ?? ''}fastque-${safeFileName(ready.salonName.toLowerCase())}-qr.png`;
      await FileSystem.writeAsStringAsync(uri, toBase64(qrMatrixToPng(createQrMatrix(ready.publicUrl), 12)), { encoding: FileSystem.EncodingType.Base64 });
      if (!(await Sharing.isAvailableAsync())) throw new Error('sharing unavailable');
      await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: ready.salonName });
      setNotice(hindi ? 'QR चित्र सहेजने या भेजने के लिए तैयार है।' : 'QR image ready to save, print or send.');
    } catch {
      setActionError(hindi ? 'QR चित्र नहीं बन सका।' : 'Could not prepare the QR image.');
    } finally {
      setAction(null);
    }
  }

  async function shareLink() {
    if (!ready) return;
    setAction('share');
    setActionError(null);
    setNotice(null);
    try {
      await Share.share({ message: `${text.trim()}\n${ready.publicUrl}`, url: ready.publicUrl });
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
      <PremiumQueueQr salonId={selectedSalonId} salonName={name} hindi={hindi} />
      <Text style={styles.sectionLabel}>{hindi ? 'दुकान बुकिंग पेज लिंक' : 'Shop booking page link'}</Text>
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
            <Text style={styles.note}>{hindi ? `लिंक के साथ भेजा जाने वाला संदेश (${text.length}/${MESSAGE_MAX})` : `Message to send with the link (${text.length} of ${MESSAGE_MAX} characters)`}</Text>
            <TextInput accessibilityLabel="Message to send with the link" value={text} onChangeText={(v) => setMessage(v.slice(0, MESSAGE_MAX))} multiline maxLength={MESSAGE_MAX} style={styles.input} />
            <Button title={hindi ? 'दुकान QR लिंक साझा करें' : 'Share shop QR link'} onPress={() => void shareLink()} loading={action === 'share'} disabled={action !== null} style={styles.button} />
            <Button title={hindi ? 'QR चित्र सहेजें / भेजें (PNG)' : 'Save / share QR image (PNG)'} variant="outline" onPress={() => void shareImage()} loading={action === 'image'} disabled={action !== null} style={styles.button} />
            <Text style={styles.note}>{hindi ? 'यह स्क्रीन सार्वजनिक दुकान लिंक का QR पूर्वावलोकन दिखाती है। शेयर से कोई संदेश अपने-आप नहीं भेजा जाता।' : 'This screen previews a QR for the public shop link. Sharing does not send messages automatically.'}</Text>
            {actionError ? <InlineError message={actionError} /> : null}
            {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
          </Card>
          <Text style={styles.sectionLabel}>{hindi ? 'अपनी दुकान Google Maps पर लाएँ' : 'Get your shop on Google Maps'}</Text>
          <Card>
            <Text style={styles.body}>{hindi
              ? 'मुफ़्त। जब कोई "salon near me" या "haircut in <शहर>" खोजता है, तो Google पहले Maps वाली दुकानें दिखाता है।'
              : "Free. When people search 'salon near me' or 'haircut in your city', Google shows Maps shops first."}</Text>
            {(hindi
              ? [
                  '1. Google Business Profile खोलें और दुकान के Gmail से लॉग इन करें।',
                  `2. नाम: बोर्ड पर लिखा "${name}" ही डालें। "best salon" जैसे शब्द न जोड़ें।`,
                  '3. कैटेगरी (Barber shop / Beauty salon / Beauty parlour / Spa), पता, मैप पिन और फ़ोन डालें।',
                  '4. Website और Booking link में अपना FastQue लिंक डालें (नीचे शेयर करके कॉपी करें)।',
                  '5. वेरिफ़िकेशन: Google आम तौर पर एक वीडियो माँगता है: बोर्ड, सड़क, दुकान के अंदर का हिस्सा और आप दुकान/काउंटर खोलते हुए। 1–5 दिन लगते हैं।',
                  '6. फिर समय, 5–10 फ़ोटो और सर्विसेज़ डालें। खुश ग्राहकों से Google review माँगें। नकली या पैसे देकर लिए गए review कभी न लें।',
                ]
              : [
                  "1. Open Google Business Profile and sign in with your shop's Gmail.",
                  `2. Business name: exactly "${name}" as on your board. Don't add words like "best salon".`,
                  '3. Category (Barber shop / Beauty salon / Beauty parlour / Spa), address, map pin and phone.',
                  '4. Website and Booking link: paste your FastQue link (share it below to copy).',
                  '5. Verify: Google usually asks for a short video showing your board, the street, inside the shop and you opening the shop or counter. It takes 1 to 5 days.',
                  '6. Then add timings, 5 to 10 photos and your services. Ask happy customers for a Google review. Never use fake or paid reviews.',
                ]
            ).map((line) => <Text key={line} style={styles.note}>{line}</Text>)}
            <Button title={hindi ? 'Google Business Profile खोलें' : 'Open Google Business Profile'} onPress={() => void Linking.openURL('https://business.google.com/create')} style={styles.button} />
            <Button title={hindi ? 'Google के लिए FastQue लिंक कॉपी/शेयर करें' : 'Copy / share FastQue link for Google'} variant="outline" onPress={() => void Share.share({ message: load.publicUrl })} style={styles.button} />
            <Text style={styles.note}>{hindi ? 'FastQue आपकी Google प्रोफ़ाइल नहीं बनाता या बदलता। यह आप अपने Google अकाउंट में करते हैं।' : 'FastQue does not create or change your Google profile. You do it in your own Google account.'}</Text>
          </Card>
        </>
      )}
    </Screen>
  );
}

const makeStyles = ({ color }: ThemeTokens) => StyleSheet.create({
  posterCard: { alignItems: 'center', backgroundColor: '#171314', borderColor: '#ff3e57' },
  brand: { color: '#ff7190', fontFamily: font.bodyBold, fontSize: fontSize.lg, letterSpacing: 2 },
  shopName: { color: '#ffffff', fontFamily: font.bodyBold, fontSize: fontSize.xl, lineHeight: 30, textAlign: 'center', marginTop: space[2], maxWidth: '100%' },
  tagline: { color: '#f6dfe5', fontFamily: font.bodyRegular, fontSize: fontSize.sm, textAlign: 'center', marginTop: space[2], marginBottom: space[3] },
  callout: { color: '#ff7190', fontFamily: font.bodyBold, fontSize: fontSize.sm, letterSpacing: 0.5, textAlign: 'center', marginTop: space[3] },
  powered: { color: '#c9c3c4', fontFamily: font.bodyRegular, fontSize: fontSize.xs, marginTop: space[1] },
  sectionLabel: { color: color.ink, fontFamily: font.bodyBold, fontSize: fontSize.base, marginTop: space[4], marginBottom: space[2] },
  body: { color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.base, lineHeight: 22 },
  note: { color: color.muted, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20, marginTop: space[3] },
  notice: { color: color.ink, fontFamily: font.bodyRegular, fontSize: fontSize.sm, marginTop: space[3] },
  button: { marginTop: space[3] },
  input: { minHeight: 72, borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, borderRadius: 8, padding: space[3], color: color.ink, fontFamily: font.bodyRegular, marginTop: space[2], textAlignVertical: 'top' },
});
