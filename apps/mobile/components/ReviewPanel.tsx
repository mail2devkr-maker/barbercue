import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { REVIEW_PATHS } from '@barbercue/shared';
import type { BookingDetailDto, ReviewDetailDto } from '@barbercue/shared';
import { apiFetch, ApiError } from '../lib/api';
import { color, font, fontSize, radius, space } from '../lib/theme';
import { Button, Card, InlineError } from './ui';

function StarPicker({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <View style={styles.starRow}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Pressable key={star} onPress={() => onChange(star)} hitSlop={6}>
          <Text style={[styles.star, star <= value ? styles.starFilled : styles.starEmpty]}>★</Text>
        </Pressable>
      ))}
    </View>
  );
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <Text style={styles.starDisplay}>
      <Text style={styles.starFilled}>{'★'.repeat(rating)}</Text>
      <Text style={styles.starEmpty}>{'★'.repeat(5 - rating)}</Text>
    </Text>
  );
}

/**
 * Phase 16 (Ratings & Reviews) — the customer-facing "leave a review" flow for a COMPLETED
 * booking, shown on BookingDetailScreen. Mirrors apps/web's ReviewPanel exactly (same endpoints,
 * same hasReview-gated fetch), since mobile is the primary customer surface.
 */
export function ReviewPanel({
  booking,
  onReviewed,
}: {
  booking: BookingDetailDto;
  onReviewed: (bookingId: string) => void;
}) {
  const [review, setReview] = useState<ReviewDetailDto | null>(null);
  const [loaded, setLoaded] = useState(!booking.hasReview);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!booking.hasReview) return;
    let cancelled = false;
    apiFetch<ReviewDetailDto | null>(`${REVIEW_PATHS.reviews}/${REVIEW_PATHS.booking}/${booking.id}`)
      .then((result) => {
        if (cancelled) return;
        setReview(result);
        if (result) {
          setRating(result.rating);
          setComment(result.comment ?? '');
        }
      })
      .catch(() => {
        /* non-critical — the panel just won't show a prefilled edit */
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [booking.id, booking.hasReview]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = review
        ? await apiFetch<ReviewDetailDto>(`${REVIEW_PATHS.reviews}/${review.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
          })
        : await apiFetch<ReviewDetailDto>(REVIEW_PATHS.reviews, {
            method: 'POST',
            body: JSON.stringify({ bookingId: booking.id, rating, comment: comment.trim() || undefined }),
          });
      setReview(result);
      setEditing(false);
      onReviewed(booking.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your review.');
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.status !== 'COMPLETED' || !loaded) return null;

  if (review && !editing) {
    return (
      <Card style={styles.card}>
        <Text style={styles.title}>Your review</Text>
        <StarDisplay rating={review.rating} />
        {review.comment ? <Text style={styles.comment}>{review.comment}</Text> : null}
        {review.ownerResponse ? (
          <Text style={styles.response}>
            <Text style={styles.responseLabel}>Shop&apos;s response: </Text>
            {review.ownerResponse}
          </Text>
        ) : null}
        <Button title="Edit your review" variant="outline" onPress={() => setEditing(true)} style={styles.editButton} />
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{review ? 'Edit your review' : 'Leave a review'}</Text>
      <StarPicker value={rating} onChange={setRating} />
      <TextInput
        value={comment}
        onChangeText={setComment}
        placeholder="Optional comment"
        placeholderTextColor={color.muted}
        multiline
        style={styles.input}
      />
      {error && <InlineError message={error} />}
      <View style={styles.actionsRow}>
        <Button
          title={submitting ? 'Saving…' : review ? 'Save review' : 'Submit review'}
          onPress={() => void submit()}
          loading={submitting}
          style={styles.actionButton}
        />
        {review && (
          <Button
            title="Cancel"
            variant="outline"
            onPress={() => setEditing(false)}
            disabled={submitting}
            style={styles.actionButton}
          />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: space[4] },
  title: { fontFamily: font.displaySemiBold, fontSize: fontSize.base, color: color.ink, marginBottom: space[2] },
  starRow: { flexDirection: 'row', gap: space[1] },
  star: { fontSize: 26, lineHeight: 30 },
  starDisplay: { fontSize: 18 },
  starFilled: { color: color.gold },
  starEmpty: { color: color.border },
  comment: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.ink, marginTop: space[2] },
  response: { fontFamily: font.bodyRegular, fontSize: fontSize.sm, color: color.muted, marginTop: space[2] },
  responseLabel: { fontFamily: font.bodySemiBold, color: color.ink },
  editButton: { marginTop: space[3] },
  input: {
    marginTop: space[3],
    minHeight: 60,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.sm,
    padding: space[3],
    fontFamily: font.bodyRegular,
    fontSize: fontSize.sm,
    color: color.ink,
    textAlignVertical: 'top',
  },
  actionsRow: { flexDirection: 'row', gap: space[2], marginTop: space[3] },
  actionButton: { flex: 1 },
});
