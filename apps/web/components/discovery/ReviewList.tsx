import type { ReviewSummaryDto } from "@barbercue/shared";

// No customer display-name field exists on User (schema gap, out of scope for this phase) — shown
// as "Verified customer" instead of a name.
export function ReviewList({ reviews }: { reviews: ReviewSummaryDto[] }) {
  if (reviews.length === 0) {
    return <p style={{ color: "#6B6357" }}>No reviews yet.</p>;
  }
  return (
    <div>
      {reviews.map((r) => (
        <div key={r.id} style={{ borderBottom: "1px solid #E7E0D3", padding: "12px 0" }}>
          <div style={{ fontWeight: 600, color: "#1C1A17" }}>
            {"★".repeat(r.rating)}
            {"☆".repeat(5 - r.rating)}{" "}
            <span style={{ fontWeight: 400, fontSize: "0.8rem", color: "#6B6357" }}>Verified customer</span>
          </div>
          {r.comment && <p style={{ margin: "4px 0 0", color: "#1C1A17" }}>{r.comment}</p>}
        </div>
      ))}
    </div>
  );
}
