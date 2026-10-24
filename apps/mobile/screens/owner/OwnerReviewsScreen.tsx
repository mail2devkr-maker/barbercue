import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { DASHBOARD_PATHS, respondToReviewSchema, type OwnerReviewDto, type PaginatedResult } from '@barbercue/shared';
import { apiFetch, ApiError } from '../../lib/api';
import { useSalon } from '../../lib/salon-context';
import { useLanguage } from '../../lib/language-context';
import { fastQue, font, fontSize, radius, space } from '../../lib/theme';
import { EmptyState, InlineError, PremiumButton, PremiumCard, PremiumScreen, PremiumSectionHeader, Skeleton } from '../../components/ui';
import { SalonSwitcher } from '../../components/owner/SalonSwitcher';

const PAGE_SIZE = 20;

function reviewsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${encodeURIComponent(salonId)}/${DASHBOARD_PATHS.reviews}`;
}

/** Owner-side Ratings & Reviews: read this shop's reviews and post (or edit) a public response. */
export default function OwnerReviewsScreen() {
  const { selectedSalonId, selectedSalon } = useSalon();
  const { t } = useLanguage();
  const [items, setItems] = useState<OwnerReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const loadPage = useCallback(
    async (salonId: string, cursor: string | undefined, mode: 'first' | 'more' | 'refresh') => {
      const request = ++requestRef.current;
      if (mode === 'more') setLoadingMore(true);
      else if (mode === 'refresh') setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
        if (cursor) params.set('cursor', cursor);
        const result = await apiFetch<PaginatedResult<OwnerReviewDto>>(`${reviewsPath(salonId)}?${params.toString()}`);
        if (request !== requestRef.current) return;
        setItems((previous) => (mode === 'more' ? [...previous, ...result.items.filter((r) => !previous.some((p) => p.id === r.id))] : result.items));
        setNextCursor(result.nextCursor);
      } catch (err) {
        if (request !== requestRef.current) return;
        setError(err instanceof ApiError ? err.message : t.reviewsLoadFailed);
      } finally {
        if (request === requestRef.current) {
          setLoading(false);
          setLoadingMore(false);
          setRefreshing(false);
        }
      }
    },
    [t],
  );

  useFocusEffect(
    useCallback(() => {
      // Reviews of one shop must never linger on screen while another shop's load.
      setItems([]);
      setNextCursor(null);
      if (selectedSalonId) void loadPage(selectedSalonId, undefined, 'first');
      else requestRef.current += 1;
    }, [selectedSalonId, loadPage]),
  );

  if (!selectedSalonId) {
    return (
      <PremiumScreen scroll={false}>
        <EmptyState title={t.selectShopTitle} message={t.chooseShopHint} />
      </PremiumScreen>
    );
  }

  return (
    <PremiumScreen refreshing={refreshing} onRefresh={() => void loadPage(selectedSalonId, undefined, 'refresh')}>
      <PremiumSectionHeader eyebrow={selectedSalon?.name ?? t.ownerEyebrow} title={t.ownerReviewsTitle} subtitle={t.reviewsSubtitle} />
      <SalonSwitcher />
      {error ? <InlineError message={error} /> : null}
      {loading && items.length === 0 ? <Skeleton style={styles.skeleton} /> : null}
      {!loading && !error && items.length === 0 ? <Text testID="reviews-empty" style={styles.empty}>{t.reviewsNone}</Text> : null}
      {items.map((review) => (
        <ReviewRow
          key={review.id}
          review={review}
          salonId={selectedSalonId}
          onResponded={(updated) => setItems((previous) => previous.map((r) => (r.id === updated.id ? updated : r)))}
        />
      ))}
      {nextCursor ? (
        <PremiumButton
          testID="reviews-load-more"
          title={t.loadMore}
          variant="secondary"
          loading={loadingMore}
          onPress={() => void loadPage(selectedSalonId, nextCursor, 'more')}
          style={styles.more}
        />
      ) : null}
    </PremiumScreen>
  );
}

function ReviewRow({ review, salonId, onResponded }: { review: OwnerReviewDto; salonId: string; onResponded: (updated: OwnerReviewDto) => void }) {
  const { t } = useLanguage();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.ownerResponse ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const parsed = respondToReviewSchema.safeParse({ ownerResponse: text });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t.reviewResponseFailed);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<OwnerReviewDto>(`${reviewsPath(salonId)}/${encodeURIComponent(review.id)}/${DASHBOARD_PATHS.response}`, {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      onResponded(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t.reviewResponseFailed);
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = editing || !review.ownerResponse;
  return (
    <PremiumCard style={styles.card}>
      <View style={styles.topRow} testID={`review-${review.id}`}>
        <Text style={styles.stars} accessibilityLabel={`${review.rating} / 5`}>
          {'★'.repeat(Math.max(0, Math.min(5, review.rating)))}
          <Text style={styles.starsOff}>{'★'.repeat(Math.max(0, 5 - review.rating))}</Text>
        </Text>
        <Text style={styles.meta}>
          {review.serviceName} · {new Date(review.createdAt).toLocaleDateString()}
        </Text>
      </View>
      {review.comment ? <Text style={styles.comment}>{review.comment}</Text> : null}
      <Text style={styles.meta}>{review.customerPhone ?? review.customerEmail ?? t.reviewNoContact}</Text>

      {review.ownerResponse && !editing ? (
        <View style={styles.response}>
          <Text style={styles.responseText}>
            <Text style={styles.responseLabel}>{t.reviewYourResponse} </Text>
            {review.ownerResponse}
          </Text>
          <PremiumButton testID={`review-edit-${review.id}`} title={t.reviewEditResponse} variant="secondary" onPress={() => setEditing(true)} style={styles.small} />
        </View>
      ) : null}

      {showForm ? (
        <View style={styles.form}>
          <TextInput
            testID={`review-input-${review.id}`}
            value={text}
            onChangeText={setText}
            placeholder={t.reviewResponsePlaceholder}
            placeholderTextColor={fastQue.textMuted}
            multiline
            maxLength={1000}
            style={styles.input}
            accessibilityLabel={t.reviewResponsePlaceholder}
          />
          {error ? <InlineError message={error} /> : null}
          <View style={styles.formButtons}>
            <PremiumButton testID={`review-post-${review.id}`} title={submitting ? t.savingEllipsis : t.reviewPostResponse} onPress={() => void submit()} loading={submitting} style={styles.small} />
            {review.ownerResponse ? <PremiumButton title={t.cancelAction} variant="secondary" onPress={() => setEditing(false)} style={styles.small} /> : null}
          </View>
        </View>
      ) : null}
    </PremiumCard>
  );
}

const styles = StyleSheet.create({
  skeleton: { height: 110, borderRadius: radius.lg, marginBottom: space[3] },
  empty: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: fastQue.textMuted, marginTop: space[4] },
  card: { marginBottom: space[3] },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: space[2], marginBottom: space[1] },
  stars: { color: '#F5B301', fontSize: 16 },
  starsOff: { color: fastQue.border },
  meta: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: fastQue.textMuted },
  comment: { fontFamily: font.bodyRegular, fontSize: fontSize.base, color: fastQue.text, marginVertical: space[1] },
  response: { marginTop: space[2], gap: space[2] },
  responseText: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: fastQue.textSecondary },
  responseLabel: { fontFamily: font.bodyBold, color: fastQue.text },
  form: { marginTop: space[2] },
  input: {
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: fastQue.input,
    borderWidth: 1,
    borderColor: fastQue.border,
    borderRadius: radius.sm,
    color: fastQue.text,
    fontFamily: font.bodyRegular,
    padding: space[3],
    fontSize: fontSize.base,
  },
  formButtons: { flexDirection: 'row', gap: space[2], marginTop: space[2] },
  small: { alignSelf: 'flex-start' },
  more: { marginTop: space[2] },
});
