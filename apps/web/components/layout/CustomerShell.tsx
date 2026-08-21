import { CustomerHeader } from "./CustomerHeader";
import { CustomerFooter } from "./CustomerFooter";
import styles from "./customer-shell.module.css";

// Applied to public discovery pages (search/city/locality/salon-profile) and authenticated
// customer pages (account/book/queue/style-advisor) — never to the landing page (which keeps its
// own bespoke nav-less hero treatment) or to staff/owner/admin dashboards/logins. This component
// itself does no auth gating — pages that need it keep their existing RequireRole wrapper.
export function CustomerShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <CustomerHeader />
      <main className={styles.main}>{children}</main>
      <CustomerFooter />
    </div>
  );
}
