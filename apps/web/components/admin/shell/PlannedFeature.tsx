import Link from "next/link";
import ui from "../../owner/owner.module.css";

/** An honest placeholder: what this page will show and what has to be recorded first. No sample data. */
export function PlannedFeature({ label, needs }: { label: string; needs: string }) {
  return (
    <main className={ui.grid} aria-labelledby="planned-title">
      <div className={ui.pageHead}>
        <div>
          <div className={ui.eyebrow}>Planned · Admin Dashboard 2.1</div>
          <h1 id="planned-title" className={ui.pageTitle}>{label}</h1>
          <p className={ui.pageSub}>This page is not built yet, so it shows no figures rather than sample ones.</p>
        </div>
      </div>
      <section className={ui.card}>
        <h2 className={ui.cardTitle}>What it needs first</h2>
        <p className={ui.cardSub}>{needs}</p>
        <p className={ui.cardSub}>
          The full requirement map and phases are in <code>docs/admin-dashboard-2.0/PLAN.md</code>. Meanwhile, the{" "}
          <Link href="/dashboard/admin/analytics/chart-builder" className={ui.cardLink}>Chart builder</Link> and{" "}
          <Link href="/dashboard/admin/command-center" className={ui.cardLink}>Executive overview</Link> cover the figures FastQue already records.
        </p>
      </section>
    </main>
  );
}
