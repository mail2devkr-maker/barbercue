import Link from "next/link";
import styles from "./app-state.module.css";

export default function NotFound() {
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <span className={styles.mark} aria-hidden="true">404</span>
        <h1>This chair is empty.</h1>
        <p>The page or barbershop you’re looking for may have moved or is no longer available.</p>
        <div className={styles.actions}>
          <Link href="/search">Find a barbershop</Link>
          <Link href="/">Return home</Link>
        </div>
      </div>
    </main>
  );
}
