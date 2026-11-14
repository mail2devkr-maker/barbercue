import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text } from 'react-native';
import { DASHBOARD_PATHS, Language } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { locationNudge, parseLocation, type LocationNudge } from '../../lib/location-proposal';
import { fastQue, font, fontSize, lineHeightFor, space } from '../../lib/theme';
import { PremiumButton, PremiumCard } from '../ui';

const COPY: Record<LocationNudge, { en: string; hi: string; actionEn: string | null; actionHi: string | null }> = {
  missing: {
    en: "Customers can't see how far your shop is. Set your shop's location so FastQue shows the distance and lists you for nearby customers.",
    hi: 'ग्राहक आपकी दुकान की दूरी नहीं देख पा रहे। दुकान की लोकेशन सेट करें ताकि FastQue दूरी दिखाए और पास के ग्राहकों को आपकी दुकान दिखे।',
    actionEn: 'Set shop location',
    actionHi: 'दुकान की लोकेशन सेट करें',
  },
  rejected: {
    en: "Your last shop location was not approved, so customers still can't see how far your shop is. Please send it again from inside the shop.",
    hi: 'आपकी पिछली लोकेशन मंज़ूर नहीं हुई, इसलिए ग्राहक अभी भी दूरी नहीं देख पा रहे। कृपया दुकान के अंदर से फिर से भेजें।',
    actionEn: 'Send location again',
    actionHi: 'लोकेशन फिर से भेजें',
  },
  pending: {
    en: 'Your shop location has been sent and is waiting for FastQue approval. Distance shows to customers once it is approved.',
    hi: 'आपकी दुकान की लोकेशन भेज दी गई है और FastQue की मंज़ूरी का इंतज़ार है। मंज़ूरी के बाद ग्राहकों को दूरी दिखेगी।',
    actionEn: null,
    actionHi: null,
  },
};

/**
 * Owner report (14 Nov): only 6 of 108 active shops had a map pin, so most shops showed customers
 * no distance. Shown on the owner Dashboard until the shop has an approved pin (same owner-only
 * location endpoint as ShopLocationPanel). Shows nothing if the location can't be read.
 */
export function OwnerLocationNudge({ salonId, language, onSetLocation }: { salonId: string; language: Language; onSetLocation: () => void }) {
  const [nudge, setNudge] = useState<LocationNudge | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const path = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.location}`;
      apiFetch<unknown>(path)
        .then((raw) => {
          if (!cancelled) setNudge(locationNudge(parseLocation(raw)));
        })
        .catch(() => {
          if (!cancelled) setNudge(null);
        });
      return () => {
        cancelled = true;
      };
    }, [salonId]),
  );

  if (!nudge) return null;
  const copy = COPY[nudge];
  const hi = language === Language.HI;
  const action = hi ? copy.actionHi : copy.actionEn;
  return (
    <PremiumCard style={styles.card}>
      <Text style={styles.text}>📍 {hi ? copy.hi : copy.en}</Text>
      {action && <PremiumButton title={action} onPress={onSetLocation} style={styles.button} />}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4], borderColor: fastQue.pink, borderWidth: 1 },
  text: { fontFamily: font.bodyMedium, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), color: fastQue.text },
  button: { marginTop: space[3] },
});
