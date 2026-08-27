import Link from "next/link";
import styles from "./dashboard-shell.module.css";

/**
 * Role-neutral navigation for every authenticated dashboard surface. Authentication and role
 * routing stay in their existing layouts; this header only guarantees that owners, staff and
 * admins always have an obvious path back to the public BarberCue experience.
 */
export function DashboardHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.wordmark} aria-label="BarberCue home">
          <span className={styles.mark} aria-hidden="true">BC</span>
          <span>BarberCue</span>
        </Link>
        <Link href="/" className={styles.publicLink}>
          <span aria-hidden="true">←</span> Visit public site
        </Link>
      </div>
    </header>
  );
}
