import styles from "./app-state.module.css";

export default function Loading() {
  return (
    <main className={styles.page} aria-label="Loading page" aria-busy="true">
      <div className={styles.loading}>
        <div className={styles.loadingHeader} />
        <div className={styles.loadingLine} />
        <div className={styles.loadingGrid}>
          <div className={styles.loadingBlock} />
          <div className={styles.loadingBlock} />
          <div className={styles.loadingBlock} />
        </div>
      </div>
    </main>
  );
}
