import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, View } from 'react-native';
import { DASHBOARD_PATHS, type PhotoDto } from '@barbercue/shared';
import { apiFetch } from '../../lib/api';
import { pickCoverPhoto } from '../../lib/owner-dashboard-layout';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { SafeImage } from '../ui/SafeImage';
import { scope } from './ShopSetupSections';

/**
 * Owner request (16 Nov 2026): the shop's cover photo as the hero at the top of the owner dashboard.
 * Uses the owner's own uploaded photo only; a shop with no photo (or a failed load) shows nothing,
 * never a stock image.
 */
export function OwnerShopHero({ salonId, name }: { salonId: string; name: string }) {
  const [photo, setPhoto] = useState<PhotoDto | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      apiFetch<PhotoDto[]>(scope(salonId, DASHBOARD_PATHS.photos))
        .then((photos) => {
          if (!cancelled) setPhoto(pickCoverPhoto(photos));
        })
        .catch(() => {
          if (!cancelled) setPhoto(null);
        });
      return () => {
        cancelled = true;
      };
    }, [salonId]),
  );

  if (!photo) return null;
  return (
    <View style={styles.wrap}>
      <SafeImage url={photo.url} alt={photo.altText ?? `${name} cover photo`} style={styles.image} />
      <View style={styles.scrim} />
      <View style={styles.overlay}>
        <Text style={styles.name} numberOfLines={2}>{name}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: space[4], backgroundColor: fastQue.card },
  image: { width: '100%', height: 200 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '60%', backgroundColor: 'rgba(0, 0, 0, 0.45)' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space[4] },
  name: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: '#ffffff' },
});
