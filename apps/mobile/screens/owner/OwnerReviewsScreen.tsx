import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS, isValidReviewProfileUrl, type OwnerReviewDto, type OwnerReviewsResponseDto, type ReviewProfileProvider, type ReviewSource, type ReviewSourceDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { dateLocaleFor } from '../../lib/date-locale';
import { useLanguage } from '../../lib/language-context';
import { useSalon } from '../../lib/salon-context';
import { fastQue, font, fontSize, lineHeightFor, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import type { OwnerShopStackParamList } from '../../navigation/OwnerShopStack';

type Props = NativeStackScreenProps<OwnerShopStackParamList, 'OwnerReviews'>;
const sources: ReviewSource[] = ['FASTQUE', 'GOOGLE', 'FACEBOOK', 'INSTAGRAM'];
const PAGE_SIZE = 20;

const sourceNames = {
  EN: { FASTQUE: 'FastQue', GOOGLE: 'Google', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' },
  HI: { FASTQUE: 'FastQue', GOOGLE: 'Google', FACEBOOK: 'Facebook', INSTAGRAM: 'Instagram' },
} as const;
const copy = {
  EN: {
    title: 'Reviews', subtitle: 'Read customer feedback and respond publicly as your shop.',
    empty: 'No reviews yet.', loading: 'Loading reviews…', retry: 'Could not load reviews. Please try again.',
    linkOnly: 'FastQue stores this profile link only; reviews are not imported from this provider.',
    unavailable: 'This provider is not connected. No external reviews are being fetched.',
    profile: 'Open review profile', noProfile: 'No review profile link is set.',
    service: 'Service', response: 'Your public response', write: 'Write a public response…',
    reply: 'Post response', edit: 'Edit response', save: 'Saving…', cancel: 'Cancel',
    saveError: 'Could not save your response. Please try again.', loadMore: 'Load more', loadingMore: 'Loading…',
    noShop: 'Choose a shop to see its reviews.', noComment: 'No written comment.',
  },
  HI: {
    title: 'समीक्षाएँ', subtitle: 'ग्राहकों की प्रतिक्रिया पढ़ें और अपनी दुकान की ओर से सार्वजनिक उत्तर दें।',
    empty: 'अभी कोई समीक्षा नहीं है।', loading: 'समीक्षाएँ लोड हो रही हैं…', retry: 'समीक्षाएँ लोड नहीं हुईं। फिर प्रयास करें।',
    linkOnly: 'FastQue केवल प्रोफ़ाइल लिंक रखता है; इस प्रदाता की समीक्षाएँ आयात नहीं होतीं।',
    unavailable: 'यह प्रदाता जुड़ा नहीं है। बाहरी समीक्षाएँ प्राप्त नहीं की जा रहीं।',
    profile: 'समीक्षा प्रोफ़ाइल खोलें', noProfile: 'समीक्षा प्रोफ़ाइल लिंक सेट नहीं है।',
    service: 'सेवा', response: 'आपका सार्वजनिक उत्तर', write: 'सार्वजनिक उत्तर लिखें…',
    reply: 'उत्तर प्रकाशित करें', edit: 'उत्तर संपादित करें', save: 'सहेजा जा रहा है…', cancel: 'रद्द करें',
    saveError: 'उत्तर सहेजा नहीं जा सका। फिर प्रयास करें।', loadMore: 'और देखें', loadingMore: 'लोड हो रहा है…',
    noShop: 'समीक्षाएँ देखने के लिए दुकान चुनें।', noComment: 'लिखित टिप्पणी नहीं है।',
  },
} as const;

function reviewsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.reviews}`;
}

function responsePath(salonId: string, reviewId: string): string {
  return `${reviewsPath(salonId)}/${encodeURIComponent(reviewId)}/${DASHBOARD_PATHS.response}`;
}

function queryPath(salonId: string, source: ReviewSource, cursor?: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (source !== 'FASTQUE') params.set('source', source);
  if (cursor) params.set('cursor', cursor);
  return `${reviewsPath(salonId)}?${params.toString()}`;
}

export default function OwnerReviewsScreen(_props: Props) {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { language } = useLanguage();
  const labels = language === 'HI' ? copy.HI : copy.EN;
  const providerNames = language === 'HI' ? sourceNames.HI : sourceNames.EN;
  const [source, setSource] = useState<ReviewSource>('FASTQUE');
  const [items, setItems] = useState<OwnerReviewDto[]>([]);
  const [profileSources, setProfileSources] = useState<ReviewSourceDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async (refresh = false, cursor?: string) => {
    const currentRequest = refresh || !cursor ? ++requestId.current : requestId.current;
    if (!selectedSalonId) {
      setItems([]); setProfileSources([]); setNextCursor(null); setError(null); setLoading(false); return;
    }
    if (cursor) setLoadingMore(true);
    else if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<OwnerReviewsResponseDto>(queryPath(selectedSalonId, source, cursor));
      if (currentRequest !== requestId.current) return;
      setItems((previous) => {
        if (!cursor) return result.items;
        const known = new Set(previous.map((review) => review.id));
        return [...previous, ...result.items.filter((review) => !known.has(review.id))];
      });
      setNextCursor(result.nextCursor);
      setProfileSources(result.sources ?? []);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setError(err instanceof ApiError ? err.message : labels.retry);
      if (!cursor) { setItems([]); setNextCursor(null); }
    } finally {
      if (currentRequest === requestId.current) {
        setLoading(false); setRefreshing(false); setLoadingMore(false);
      }
    }
  }, [labels.retry, selectedSalonId, source]);

  useFocusEffect(useCallback(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]));

  const selectedProvider = profileSources.find((item) => item.source === source);
  const external = source !== 'FASTQUE';
  const providerName = source === 'GOOGLE' ? 'google' : source === 'FACEBOOK' ? 'facebook' : source === 'INSTAGRAM' ? 'instagram' : null;
  const safeProfileUrl = selectedProvider?.profileUrl && providerName && isValidReviewProfileUrl(providerName as ReviewProfileProvider, selectedProvider.profileUrl)
    ? selectedProvider.profileUrl
    : null;

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void load(true)}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name} title={labels.title} subtitle={labels.subtitle} />
      {!selectedSalonId ? <EmptyState title={labels.title} message={labels.noShop} /> : (
        <>
          <View style={styles.sourceRow} accessibilityRole="tablist">
            {sources.map((option) => {
              const selected = source === option;
              return <Pressable key={option} accessibilityRole="tab" accessibilityState={{ selected }} onPress={() => setSource(option)} style={[styles.sourceButton, selected && styles.sourceSelected]}>
                <Text style={[styles.sourceText, selected && styles.sourceTextSelected]}>{providerNames[option]}</Text>
              </Pressable>;
            })}
          </View>
          {error ? <InlineError message={error} /> : null}
          {loading ? <View style={styles.loading}><Text style={styles.meta}>{labels.loading}</Text><Skeleton style={styles.skeleton} /></View> : external ? (
            <PremiumCard>
              <Text style={styles.cardTitle}>{providerNames[source]}</Text>
              <Text style={styles.body}>{selectedProvider?.state === 'LINK_ONLY' ? labels.linkOnly : labels.unavailable}</Text>
              {safeProfileUrl ? <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(safeProfileUrl).catch(() => undefined); }} style={styles.profileLink}>
                <Text style={styles.profileLinkText}>{labels.profile}</Text>
              </Pressable> : <Text style={styles.meta}>{labels.noProfile}</Text>}
            </PremiumCard>
          ) : items.length === 0 ? <EmptyState title={labels.empty} message={labels.empty} /> : (
            <>
              {items.map((review) => <ReviewCard key={review.id} review={review} salonId={selectedSalonId} labels={labels} locale={dateLocaleFor(language)} onUpdated={(updated) => setItems((previous) => previous.map((item) => item.id === updated.id ? updated : item))} />)}
              {nextCursor ? <Pressable accessibilityRole="button" onPress={() => void load(false, nextCursor)} disabled={loadingMore} style={styles.moreButton}>
                <Text style={styles.moreText}>{loadingMore ? labels.loadingMore : labels.loadMore}</Text>
              </Pressable> : null}
            </>
          )}
        </>
      )}
    </PremiumScreen>
  );
}

function ReviewCard({ review, salonId, labels, locale, onUpdated }: {
  review: OwnerReviewDto; salonId: string; labels: (typeof copy)['EN'] | (typeof copy)['HI']; locale: string; onUpdated: (updated: OwnerReviewDto) => void;
}) {
  const [editing, setEditing] = useState(!review.ownerResponse);
  const [draft, setDraft] = useState(review.ownerResponse ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const ownerResponse = draft.trim();
    if (!ownerResponse || ownerResponse.length > 1000 || saving) return;
    setSaving(true); setError(null);
    try {
      const updated = await apiFetch<OwnerReviewDto>(responsePath(salonId, review.id), {
        method: 'PUT', body: JSON.stringify({ ownerResponse }),
      });
      onUpdated(updated); setDraft(updated.ownerResponse ?? ownerResponse); setEditing(false);
    } catch {
      setError(labels.saveError);
    } finally { setSaving(false); }
  };

  return (
    <PremiumCard style={styles.reviewCard}>
      <View style={styles.reviewHeading}>
        <Text accessibilityLabel={`${review.rating} out of 5 stars`} style={styles.rating}>{'★'.repeat(Math.max(0, Math.min(5, review.rating)))}{'☆'.repeat(Math.max(0, 5 - review.rating))}</Text>
        <Text style={styles.meta}>{review.serviceName} · {new Date(review.createdAt).toLocaleDateString(locale)}</Text>
      </View>
      <Text style={styles.comment}>{review.comment?.trim() || labels.noComment}</Text>
      {review.ownerResponse && !editing ? (
        <View style={styles.responseBox}>
          <Text style={styles.responseLabel}>{labels.response}</Text>
          <Text style={styles.body}>{review.ownerResponse}</Text>
          <Pressable accessibilityRole="button" onPress={() => { setDraft(review.ownerResponse ?? ''); setEditing(true); }} style={styles.textButton}>
            <Text style={styles.profileLinkText}>{labels.edit}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.editor}>
          <TextInput
            accessibilityLabel={labels.write}
            value={draft}
            onChangeText={setDraft}
            placeholder={labels.write}
            placeholderTextColor={fastQue.textMuted}
            maxLength={1000}
            multiline
            editable={!saving}
            style={styles.input}
          />
          <Text style={styles.meta}>{draft.trim().length}/1000</Text>
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <View style={styles.actionRow}>
            <Pressable accessibilityRole="button" disabled={saving || !draft.trim()} onPress={() => void save()} style={[styles.actionButton, (saving || !draft.trim()) && styles.disabled]}>
              <Text style={styles.actionText}>{saving ? labels.save : labels.reply}</Text>
            </Pressable>
            {review.ownerResponse ? <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setDraft(review.ownerResponse ?? ''); setError(null); setEditing(false); }} style={styles.cancelButton}>
              <Text style={styles.cancelText}>{labels.cancel}</Text>
            </Pressable> : null}
          </View>
        </View>
      )}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  sourceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[4] },
  sourceButton: { minHeight: 40, paddingHorizontal: space[3], borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, justifyContent: 'center' },
  sourceSelected: { borderColor: fastQue.borderStrong, backgroundColor: fastQue.card },
  sourceText: { color: fastQue.textMuted, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  sourceTextSelected: { color: fastQue.text, fontFamily: font.bodyBold },
  reviewCard: { marginBottom: space[3] },
  cardTitle: { color: fastQue.text, fontFamily: font.displaySemiBold, fontSize: fontSize.lg, marginBottom: space[3] },
  reviewHeading: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: space[2], marginBottom: space[2] },
  rating: { color: fastQue.orange, fontSize: fontSize.lg, letterSpacing: 1 },
  meta: { color: fastQue.textMuted, fontFamily: font.bodyRegular, fontSize: fontSize.xs },
  comment: { color: fastQue.text, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm), marginBottom: space[3] },
  responseBox: { gap: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, paddingTop: space[3] },
  responseLabel: { color: fastQue.textSecondary, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  body: { color: fastQue.textSecondary, fontFamily: font.bodyRegular, fontSize: fontSize.sm, lineHeight: lineHeightFor(fontSize.sm) },
  textButton: { alignSelf: 'flex-start', paddingVertical: space[1] },
  profileLink: { marginTop: space[3], alignSelf: 'flex-start', minHeight: 42, justifyContent: 'center' },
  profileLinkText: { color: fastQue.coral, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  editor: { gap: space[2], borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: fastQue.border, paddingTop: space[3] },
  input: { minHeight: 84, borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.md, backgroundColor: fastQue.input, color: fastQue.text, padding: space[3], fontFamily: font.bodyRegular, fontSize: fontSize.sm, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', gap: space[2], marginTop: space[1] },
  actionButton: { minHeight: 42, paddingHorizontal: space[4], borderRadius: radius.pill, backgroundColor: fastQue.coral, alignItems: 'center', justifyContent: 'center' },
  actionText: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.xs },
  disabled: { opacity: 0.5 },
  cancelButton: { minHeight: 42, paddingHorizontal: space[4], borderRadius: radius.pill, borderWidth: 1, borderColor: fastQue.border, alignItems: 'center', justifyContent: 'center' },
  cancelText: { color: fastQue.textSecondary, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  error: { color: fastQue.error, fontFamily: font.bodyMedium, fontSize: fontSize.xs },
  moreButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: fastQue.border, borderRadius: radius.pill, marginBottom: space[4] },
  moreText: { color: fastQue.text, fontFamily: font.bodySemiBold, fontSize: fontSize.sm },
  loading: { gap: space[3] },
  skeleton: { height: 180, borderRadius: radius.lg },
});
