import type { ReviewSummaryDto } from "@barbercue/shared";

// No customer display-name field exists on User (schema gap, out of scope for this phase) — shown
// as "Verified customer" instead of a name.
export function ReviewList({ reviews }: { reviews: ReviewSummaryDto[] }) {
  if (reviews.length === 0) {
    return <p style={{ color: "var(--bc-muted)" }}>No reviews yet.</p>;
  }
  return (
    <div>
      {reviews.map((r) => (
        <div key={r.id} style={{ borderBottom: "1px solid var(--bc-border)", padding: "16px 0" }}>
          <div style={{ fontWeight: 600, color: "var(--bc-gold)", letterSpacing: "0.02em" }}>
            {"★".repeat(r.rating)}
            {"☆".repeat(5 - r.rating)}{" "}
            <span style={{ fontWeight: 500, fontSize: "0.8rem", color: "var(--bc-muted)" }}>Verified customer</span>
          </div>
          {r.comment && <p style={{ margin: "6px 0 0", color: "var(--bc-ink)", lineHeight: 1.5 }}>{r.comment}</p>}
        </div>
      ))}
    </div>
  );
}
