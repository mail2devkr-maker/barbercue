"use client";

import Link from "next/link";
import styles from "./app-state.module.css";

export default function ErrorPage({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <main className={styles.page}>
      <div className={styles.card} role="alert">
        <span className={styles.mark} aria-hidden="true">!</span>
        <h1>That page hit a snag.</h1>
        <p>Try loading the page again, or return home and choose another route.</p>
        <div className={styles.actions}>
          <button type="button" onClick={() => unstable_retry()}>Try again</button>
          <Link href="/">Return home</Link>
        </div>
      </div>
    </main>
  );
}
