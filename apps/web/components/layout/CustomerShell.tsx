import { CustomerHeader } from "./CustomerHeader";
import { SiteFooter } from "./SiteFooter";
import { OfflineBanner } from "./OfflineBanner";
import styles from "./customer-shell.module.css";

// Applied to public discovery pages (search/city/locality/salon-profile) and authenticated
// customer pages (account/book/queue/style-advisor) — never to the landing page (which keeps its
// own bespoke nav-less hero treatment) or to staff/owner/admin dashboards/logins. This component
// itself does no auth gating — pages that need it keep their existing RequireRole wrapper.
//
// `dark` opts a single page's header/footer chrome into the approved landing-page premium tokens
// (owner correction: /search must not sit under the default cream header). Defaults to the
// existing cream treatment so every other CustomerShell consumer (account/book/queue/
// style-advisor/city/salon-profile) renders exactly as before — this is additive, not a retheme.
export function CustomerShell({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <div className={`${styles.shell} ${dark ? styles.dark : ""}`}>
      <OfflineBanner />
      <CustomerHeader dark />
      <div className={styles.main}>{children}</div>
      <SiteFooter />
    </div>
  );
}
