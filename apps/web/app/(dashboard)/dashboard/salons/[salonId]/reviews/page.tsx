"use client";

import { use, useCallback, useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import type { OwnerReviewDto, PaginatedResult } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../../../../../lib/api";
import { Button } from "../../../../../../components/ui/Button";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

function reviewsPath(salonId: string): string {
  return `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.reviews}`;
}
function respondPath(salonId: string, reviewId: string): string {
  return `${reviewsPath(salonId)}/${reviewId}/${DASHBOARD_PATHS.response}`;
}

function Stars({ rating }: { rating: number }) {
  return (
    <span style={{ color: "var(--bc-gold)", fontSize: 15 }}>
      {"★".repeat(rating)}
      <span style={{ color: "var(--bc-border)" }}>{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function ReviewRow({
  review,
  salonId,
  onResponded,
}: {
  review: OwnerReviewDto;
  salonId: string;
  onResponded: (updated: OwnerReviewDto) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.ownerResponse ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiFetch<OwnerReviewDto>(respondPath(salonId, review.id), {
        method: "PUT",
        body: JSON.stringify({ ownerResponse: trimmed }),
      });
      onResponded(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your response.");
    } finally {
      setSubmitting(false);
    }
  }

  const showForm = editing || !review.ownerResponse;

  return (
    <li className={styles.row} style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Stars rating={review.rating} />
        <span className={styles.rowMeta}>
          {review.serviceName} · {new Date(review.createdAt).toLocaleDateString()}
        </span>
      </div>
      {review.comment && <p style={{ margin: "4px 0", fontSize: "var(--bc-text-sm)" }}>{review.comment}</p>}
      <div className={styles.rowMeta}>{review.customerPhone ?? review.customerEmail ?? "No contact on file"}</div>

      {review.ownerResponse && !editing && (
        <div style={{ marginTop: 4, fontSize: "var(--bc-text-sm)", color: "var(--bc-muted)" }}>
          <strong>Your response:</strong> {review.ownerResponse}{" "}
          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ background: "none", border: "none", color: "var(--bc-accent)", cursor: "pointer", fontSize: "inherit", padding: 0 }}
          >
            Edit
          </button>
        </div>
      )}

      {showForm && (
        <div style={{ marginTop: 4 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a public response…"
            rows={2}
            style={{ width: "100%", padding: 8, borderRadius: 8, border: "1px solid var(--bc-border)" }}
          />
          {error && (
            <p role="alert" style={{ color: "var(--bc-accent)", fontSize: "var(--bc-text-sm)" }}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <Button type="button" onClick={() => void submit()} disabled={submitting || !text.trim()}>
              {submitting ? "Saving…" : "Post response"}
            </Button>
            {review.ownerResponse && (
              <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={submitting}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Owner-side Ratings & Reviews (Phase 16) — reads/responds to this salon's reviews. The public
 * read side (aggregate rating + recent reviews on the salon's own discovery profile page) already
 * existed; this is the missing "owner can see and respond" half.
 */
export default function DashboardReviewsPage({
  params,
}: {
  params: Promise<{ salonId: string }>;
}) {
  const { salonId } = use(params);
  const [items, setItems] = useState<OwnerReviewDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    (cursor: string | undefined, append: boolean) => {
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      const params2 = new URLSearchParams({ limit: "20" });
      if (cursor) params2.set("cursor", cursor);
      return apiFetch<PaginatedResult<OwnerReviewDto>>(`${reviewsPath(salonId)}?${params2}`)
        .then((result) => {
          setItems((prev) => (append ? [...prev, ...result.items] : result.items));
          setNextCursor(result.nextCursor);
        })
        .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load reviews."))
        .finally(() => {
          setLoading(false);
          setLoadingMore(false);
        });
    },
    [salonId],
  );

  useEffect(() => {
    // Deferred a tick so this effect body never calls setState synchronously.
    void Promise.resolve().then(() => loadPage(undefined, false));
  }, [loadPage]);

  function handleResponded(updated: OwnerReviewDto) {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Reviews</h1>
      <p className={styles.pageSubtitle}>
        What customers are saying about your shop. Respond publicly — your reply shows up
        alongside the review on your shop&apos;s profile.
      </p>

      {error && <p className={`${styles.banner} ${styles.bannerError}`}>{error}</p>}
      {loading && <p className={styles.loadingText}>Loading…</p>}
      {!loading && items.length === 0 && <p className={styles.emptyState}>No reviews yet.</p>}

      {items.length > 0 && (
        <ul className={styles.rowList} style={{ margin: "16px 0" }}>
          {items.map((r) => (
            <ReviewRow key={r.id} review={r} salonId={salonId} onResponded={handleResponded} />
          ))}
        </ul>
      )}

      {nextCursor && (
        <Button type="button" variant="outline" onClick={() => void loadPage(nextCursor, true)} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </main>
  );
}
