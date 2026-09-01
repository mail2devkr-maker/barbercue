import type { PublicSalonStatusDto } from "@barbercue/shared";
import styles from "./public-salon-status.module.css";

export function PublicSalonStatus({ status, compact = false }: { status: PublicSalonStatusDto; compact?: boolean }) {
  return (
    <section className={`${styles.card} ${compact ? styles.compact : ""}`} aria-labelledby="salon-operations-heading">
      <div className={styles.headingRow}>
        <div>
          <p className={styles.eyebrow}>Live shop snapshot</p>
          <h2 id="salon-operations-heading">A chair when you&apos;re ready</h2>
        </div>
        <span className={styles.chairCount}>
          <strong>{status.activeChairCount}</strong> active chair{status.activeChairCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className={styles.professionalList}>
        {status.professionals.length > 0 ? (
          status.professionals.map((professional) => (
            <div className={styles.professional} key={professional.displayName}>
              <span className={styles.statusDot} aria-hidden="true" />
              <span className={styles.name}>{professional.displayName}</span>
              <span className={styles.queueCount}>
                {professional.activeQueueCount} customer{professional.activeQueueCount === 1 ? "" : "s"} waiting
              </span>
            </div>
          ))
        ) : (
          <p className={styles.empty}>Professional availability will appear here during shop hours.</p>
        )}
      </div>
      <p className={styles.note}>Counts are live, aggregate signals. No customer details are shown.</p>
    </section>
  );
}
