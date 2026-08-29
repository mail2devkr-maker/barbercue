"use client";

import { useEffect, useState } from "react";
import { REVIEW_PATHS } from "@barbercue/shared";
import type { BookingDetailDto, ReviewDetailDto } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { Button } from "../ui/Button";

function StarPicker({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <div role="radiogroup" aria-label="Rating" style={{ display: "flex", gap: 4 }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          onClick={() => onChange(star)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 22,
            lineHeight: 1,
            padding: 2,
            color: star <= value ? "var(--bc-gold)" : "var(--bc-border)",
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
}

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5 stars`} style={{ color: "var(--bc-gold)", fontSize: 16 }}>
      {"★".repeat(rating)}
      <span style={{ color: "var(--bc-border)" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

/**
 * Phase 16 (Ratings & Reviews) — the customer-facing "leave a review" flow for a COMPLETED
 * booking. Only renders for a completed booking; `booking.hasReview` (set on BookingDetailDto by
 * the backend) decides whether to fetch the existing review or show a blank submission form,
 * avoiding an unconditional round-trip for the vast majority of bookings that were never reviewed.
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
  const [comment, setComment] = useState("");
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
          setComment(result.comment ?? "");
        }
      })
      .catch(() => {
        /* the "Leave a review" affordance just won't show a prefilled edit — non-critical */
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
            method: "PATCH",
            body: JSON.stringify({ rating, comment: comment.trim() || undefined }),
          })
        : await apiFetch<ReviewDetailDto>(REVIEW_PATHS.reviews, {
            method: "POST",
            body: JSON.stringify({ bookingId: booking.id, rating, comment: comment.trim() || undefined }),
          });
      setReview(result);
      setEditing(false);
      onReviewed(booking.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your review.");
    } finally {
      setSubmitting(false);
    }
  }

  if (booking.status !== "COMPLETED" || !loaded) return null;

  if (review && !editing) {
    return (
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--bc-border)" }}>
        <StarDisplay rating={review.rating} />
        {review.comment && <p style={{ margin: "4px 0", fontSize: "var(--bc-text-sm)" }}>{review.comment}</p>}
        {review.ownerResponse && (
          <p style={{ margin: "4px 0", fontSize: "var(--bc-text-sm)", color: "var(--bc-muted)" }}>
            <strong>Shop&apos;s response:</strong> {review.ownerResponse}
          </p>
        )}
        <Button type="button" variant="outline" onClick={() => setEditing(true)}>
          Edit your review
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--bc-border)" }}>
      <StarPicker value={rating} onChange={setRating} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Optional comment"
        rows={2}
        style={{ width: "100%", marginTop: 8, padding: 8, borderRadius: 8, border: "1px solid var(--bc-border)" }}
      />
      {error && (
        <p role="alert" style={{ color: "var(--bc-accent)", fontSize: "var(--bc-text-sm)" }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? "Saving…" : review ? "Save review" : "Submit review"}
        </Button>
        {review && (
          <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
