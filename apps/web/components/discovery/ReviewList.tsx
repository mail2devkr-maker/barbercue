import type { ReviewSummaryDto } from "@barbercue/shared";
import styles from "./discovery-content.module.css";

// No customer display-name field exists on User (schema gap, out of scope for this phase) — shown
// as "Verified customer" instead of a name.
export function ReviewList({ reviews }: { reviews: ReviewSummaryDto[] }) {
  if (reviews.length === 0) {
    return <div className={styles.empty}>No customer reviews yet.</div>;
  }
  return (
    <div className={styles.reviews}>
      {reviews.map((r) => (
        <article key={r.id} className={styles.review}>
          <div className={styles.reviewMeta}>
            <span className={styles.stars} aria-label={`${r.rating} out of 5 stars`}>
              <span aria-hidden="true">
                {"★".repeat(r.rating)}
                {"☆".repeat(5 - r.rating)}
              </span>
            </span>
            <span className={styles.verified}>Verified customer</span>
          </div>
          {r.comment && <p className={styles.comment}>{r.comment}</p>}
        </article>
      ))}
    </div>
  );
}
