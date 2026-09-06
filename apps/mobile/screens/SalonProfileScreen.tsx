import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { DISCOVERY_PATHS, VERIFICATION_BADGE_CAPTION, formatMoney } from '@barbercue/shared';
import type { PublicSalonStatusDto, SalonProfileDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Screen, Button, Skeleton, ErrorState, SafeImage, PhotoGalleryViewer } from '../components/ui';
import { PublicSalonStatus } from '../components/PublicSalonStatus';
import { useLanguage } from '../lib/language-context';
import type { SearchStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<SearchStackParamList, 'SalonProfile'>;

// A wider, taller tile than a cramped grid thumbnail — big enough to actually read the photo at a
// glance in the horizontal strip, while still clearly implying "more to swipe to." 3:2 landscape,
// the same ratio real salon interior/work photos are usually shot in.
const PHOTO_TILE_WIDTH = 260;
const PHOTO_TILE_HEIGHT = 174;

// A per-person initial (not the generic "FQ" mark components/ui/SafeImage falls back to) reads
// better for a team member than a brand placeholder — kept as its own small component rather than
// SafeImage so a broken photoUrl degrades to the same initial-letter placeholder shown when there
// was never a photo at all, not a generic mark.
function TeamPhoto({ url, displayName }: { url: string | null; displayName: string }) {
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.teamPhoto}
        accessibilityLabel={displayName}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={[styles.teamPhoto, styles.teamPhotoPlaceholder]}>
      <Text style={styles.teamPhotoInitial}>{displayName.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// Public discovery endpoint — same GET /salons/:countryCode/:citySlug/:salonSlug apps/web uses (B9).
export default function SalonProfileScreen({ route, navigation }: Props) {
  const { t } = useLanguage();
  const { countryCode, citySlug, salonSlug, selectedStyleName } = route.params;
  const [salon, setSalon] = useState<SalonProfileDto | null>(null);
  const [publicStatus, setPublicStatus] = useState<PublicSalonStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [galleryIndex, setGalleryIndex] = useState<number | null>(null);

  const load = useCallback(
    (isRefresh: boolean) => {
      isRefresh ? setRefreshing(true) : setLoading(true);
      setError(null);
      const profileRequest = apiFetch<SalonProfileDto>(`${DISCOVERY_PATHS.salons}/${countryCode}/${citySlug}/${salonSlug}`);
      const statusRequest = apiFetch<PublicSalonStatusDto>(
        `${DISCOVERY_PATHS.salons}/${countryCode}/${citySlug}/${salonSlug}/${DISCOVERY_PATHS.status}`,
      ).catch(() => null);
      return Promise.all([profileRequest, statusRequest])
        .then(([result, status]) => {
          setSalon(result);
          setPublicStatus(status);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : t.couldNotLoadSalon))
        .finally(() => {
          setLoading(false);
          setRefreshing(false);
        });
    },
    [countryCode, citySlug, salonSlug],
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load]),
  );

  if (loading) {
    return (
      <Screen>
        <Skeleton style={styles.heroSkeleton} />
        <Skeleton style={styles.lineSkeleton} />
        <Skeleton style={[styles.lineSkeleton, { width: '60%' }]} />
      </Screen>
    );
  }
  if (error || !salon) {
    return (
      <Screen scroll={false}>
        <ErrorState message={error ?? t.salonNotFound} onRetry={() => void load(false)} />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} contentStyle={styles.screenContent}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={color.accent} />}
        showsVerticalScrollIndicator={false}
      >
        {/* Issue 8 (mobile stabilization mission) — SalonProfileDto.coverPhotoUrl (inherited from
            SalonListItemDto, already used correctly by SalonSearchScreen's cards) was never read
            or rendered anywhere in this screen, unlike apps/web's own profile page hero. SafeImage
            degrades to the same neutral placeholder as everywhere else when there's no cover.
            Build 9 physical feedback: the plain flat photo plus a separate white text block below
            it read as a generic prototype. Name/verification/rating now sit directly on the
            owner's own real cover photo (never stock — SafeImage's placeholder is the honest
            fallback when there is none), reusing apps/web's own hero scrim pattern. */}
        <View style={styles.heroWrap}>
          <SafeImage url={salon.coverPhotoUrl} alt={`${salon.name} cover photo`} style={styles.coverPhoto} />
          {salon.coverPhotoUrl && <View style={styles.heroScrim} />}
          <View style={styles.heroOverlay}>
            <Text style={[styles.heroName, !salon.coverPhotoUrl && styles.heroNameOnLight]} numberOfLines={2}>
              {salon.name}
            </Text>
            <Text style={[styles.heroAddress, !salon.coverPhotoUrl && styles.heroAddressOnLight]} numberOfLines={1}>
              {salon.addressLine}
            </Text>
          </View>
        </View>

        {salon.photos.length > 0 && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.photoStrip}
              snapToInterval={PHOTO_TILE_WIDTH + space[3]}
              decelerationRate="fast"
            >
              {salon.photos.map((photo, i) => (
                <Pressable
                  key={photo.id}
                  onPress={() => setGalleryIndex(i)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={photo.altText ?? `${salon.name} photo ${i + 1} of ${salon.photos.length}`}
                  accessibilityHint={t.photoGalleryHint}
                >
                  <SafeImage url={photo.url} alt={photo.altText ?? salon.name} style={styles.photo} />
                </Pressable>
              ))}
            </ScrollView>
            <Text style={styles.photoCount}>
              {salon.photos.length} {t.photosTapToView}
            </Text>
            <PhotoGalleryViewer
              photos={salon.photos}
              initialIndex={galleryIndex ?? 0}
              salonName={salon.name}
              visible={galleryIndex !== null}
              onClose={() => setGalleryIndex(null)}
            />
          </>
        )}

        {salon.verified && (
          <View style={styles.verifiedBadge}>
            <Text style={styles.verifiedBadgeText}>{t.verifiedBadge} — {VERIFICATION_BADGE_CAPTION}</Text>
          </View>
        )}
        {salon.ratingCount > 0 && (
          <Text style={styles.rating}>
            ★ {salon.ratingAverage?.toFixed(1)} · {salon.ratingCount} {t.reviewsSuffix}
          </Text>
        )}
        {salon.description && <Text style={styles.description}>{salon.description}</Text>}

        {publicStatus && <PublicSalonStatus status={publicStatus} />}

        <Button
          title={t.joinQueueNow}
          variant="secondary"
          onPress={() => navigation.navigate('WalkInJoin', { salonId: salon.id, salonName: salon.name, services: salon.services })}
          style={styles.queueButton}
        />

        <Text style={styles.sectionTitle}>{t.servicesLabel}</Text>
        {salon.services.map((item) => (
          <Pressable
            key={item.id}
            style={styles.card}
            onPress={() =>
              navigation.navigate('StaffSelect', {
                salonId: salon.id,
                salonName: salon.name,
                serviceId: item.id,
                serviceName: item.name,
                servicePrice: item.price,
                serviceDurationMinutes: item.durationMinutes,
                operatingHours: salon.operatingHours,
                salonTimezone: salon.salonTimezone,
                selectedStyleName,
              })
            }
          >
            <View style={styles.cardRow}>
              <Text style={styles.cardTitle}>{item.name}</Text>
              <Text style={styles.cardTitle}>{formatMoney(item.price, salon.currency, salon.countryCode)}</Text>
            </View>
            <Text style={styles.cardSubtitle}>{item.durationMinutes} {t.minutesAbbrev}</Text>
          </Pressable>
        ))}

        {salon.team.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t.meetTheTeam}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.teamStrip}>
              {salon.team.map((member) => (
                <View key={member.id} style={styles.teamCard}>
                  <TeamPhoto url={member.photoUrl} displayName={member.displayName} />
                  <Text style={styles.teamName} numberOfLines={1}>
                    {member.displayName}
                    {member.verified && <Text style={styles.verifiedMark}> ✓</Text>}
                  </Text>
                  {member.yearsExperience !== null && (
                    <Text style={styles.teamMeta}>
                      {member.yearsExperience} {t.yearsExpAbbrev}
                    </Text>
                  )}
                  {member.bio && (
                    <Text style={styles.teamBio} numberOfLines={3}>{member.bio}</Text>
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}

        {salon.operatingHours.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t.hoursLabel}</Text>
            <View style={styles.hoursCard}>
              {salon.operatingHours
                .slice()
                .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
                .map((h) => (
                  <View key={h.dayOfWeek} style={styles.hoursRow}>
                    <Text style={styles.hoursDay}>{t.dayAbbreviations[h.dayOfWeek]}</Text>
                    <Text style={styles.hoursValue}>{h.isClosed ? t.slotsClosedLabel : `${h.openTime} – ${h.closeTime}`}</Text>
                  </View>
                ))}
            </View>
          </>
        )}

        {salon.reviews.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>{t.reviewsTitle}</Text>
            {salon.reviews.slice(0, 5).map((review) => (
              <View key={review.id} style={styles.reviewCard}>
                <Text style={styles.reviewRating}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</Text>
                {review.comment && <Text style={styles.reviewComment}>{review.comment}</Text>}
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: space[5], paddingTop: space[5] },
  scrollContent: { paddingBottom: space[8] },
  heroSkeleton: { height: 180, borderRadius: radius.lg, marginBottom: space[4] },
  heroWrap: { borderRadius: radius.lg, overflow: 'hidden', marginBottom: space[4] },
  coverPhoto: { width: '100%', height: 220 },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '65%',
    backgroundColor: 'rgba(20, 16, 12, 0.5)',
    // A single flat rgba can't fade like web's gradient without expo-linear-gradient (a native
    // module, which would force a fresh binary build for what should stay a JS-only OTA update
    // here) — the bottom-heavy solid tone still does the legibility job, just without the fade.
  },
  heroOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space[4] },
  heroName: { fontFamily: font.displaySemiBold, fontSize: fontSize.xl, color: '#ffffff' },
  heroNameOnLight: { color: color.ink },
  heroAddress: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: 'rgba(255,255,255,0.85)', marginTop: space[1] },
  heroAddressOnLight: { color: color.muted },
  lineSkeleton: { height: 18, borderRadius: 6, marginBottom: space[2] },

  photoStrip: { marginBottom: space[2] },
  photo: { width: PHOTO_TILE_WIDTH, height: PHOTO_TILE_HEIGHT, borderRadius: radius.lg, marginRight: space[3] },
  photoCount: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginBottom: space[4] },

  rating: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.gold, marginTop: -space[2], marginBottom: space[2] },
  verifiedBadge: {
    alignSelf: 'flex-start',
    backgroundColor: color.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: space[3],
    paddingVertical: space[1],
    marginBottom: space[2],
  },
  verifiedBadgeText: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.success },
  description: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: 20, color: color.muted, marginBottom: space[3] },
  queueButton: { marginBottom: space[5] },

  sectionTitle: { fontFamily: font.displaySemiBold, fontSize: fontSize.lg, color: color.ink, marginTop: space[2], marginBottom: space[3] },

  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[3],
  },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.base, color: color.ink },
  cardSubtitle: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1] },

  teamStrip: { marginBottom: space[2] },
  teamCard: {
    width: 140,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[3],
    marginRight: space[3],
  },
  teamPhoto: { width: 56, height: 56, borderRadius: radius.pill, marginBottom: space[2] },
  teamPhotoPlaceholder: { backgroundColor: color.goldSoft, alignItems: 'center', justifyContent: 'center' },
  teamPhotoInitial: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.gold },
  teamName: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink },
  verifiedMark: { color: color.success, fontFamily: font.bodyBold },
  teamMeta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: 2 },
  teamBio: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted, marginTop: space[1], lineHeight: 16 },

  hoursCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[4],
  },
  hoursRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space[1] },
  hoursDay: { fontFamily: font.bodySemiBold, fontSize: fontSize.xs, color: color.ink },
  hoursValue: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.muted },

  reviewCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.md,
    padding: space[4],
    marginBottom: space[3],
  },
  reviewRating: { color: color.gold, fontSize: fontSize.sm, marginBottom: space[1] },
  reviewComment: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, lineHeight: 20 },
});
