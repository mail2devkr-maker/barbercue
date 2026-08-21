import { StyleAdvisorFlow } from "../../../components/style-advisor/StyleAdvisorFlow";

// Auth gating (RequireRole) and the CustomerShell now live in this route's layout.tsx —
// StyleAdvisorFlow itself (upload/analyze/results/hand-off logic) is untouched.
export default function StyleAdvisorPage() {
  return (
    <main style={{ padding: "2.5rem 1.5rem", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: "clamp(1.5rem, 3vw, 1.9rem)", color: "#1C1A17", marginBottom: 8 }}>
        AI Style Advisor
      </h1>
      <p style={{ color: "#6B6357", marginBottom: 28 }}>
        Upload a photo and preview a few hairstyles on your own face before you book.
      </p>
      <StyleAdvisorFlow />
    </main>
  );
}
