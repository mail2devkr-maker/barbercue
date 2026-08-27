import { StyleAdvisorFlow } from "../../../components/style-advisor/StyleAdvisorFlow";
import styles from "../../../components/style-advisor/style-advisor.module.css";

// Auth gating (RequireRole) and the CustomerShell now live in this route's layout.tsx —
// StyleAdvisorFlow itself (upload/analyze/results/hand-off logic) is untouched.
export default function StyleAdvisorPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>AI Style Advisor</h1>
      <p className={styles.pageSubtitle}>
        Upload a photo and preview a few hairstyles on your own face before you book.
      </p>
      <StyleAdvisorFlow />
    </main>
  );
}
