"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { WorkJobCardDto } from "@barbercue/shared";
import { useAuth } from "../../../lib/auth-context";
import { apiFetchBlob } from "../../../lib/api";
import { hoursBetween, money, PAY_TYPE_LABEL, when } from "../../../lib/work";
import styles from "./work.module.css";

export function WorkNav() {
  const pathname = usePathname();
  const { status } = useAuth();
  const items = [
    { href: "/work", label: "Find work", exact: true },
    { href: "/work/me", label: "My work" },
    { href: "/work/business", label: "For businesses" },
  ];
  return (
    <nav className={styles.nav} aria-label="FastQue Work">
      {items.map((i) => {
        const active = i.exact ? pathname === i.href || pathname.startsWith("/work/jobs") : pathname.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} className={`${styles.navLink} ${active ? styles.navLinkActive : ""}`} aria-current={active ? "page" : undefined}>
            {i.label}
          </Link>
        );
      })}
      {status === "unauthenticated" && (
        <Link href="/login?next=/work/me" className={styles.navLink}>
          Sign in
        </Link>
      )}
    </nav>
  );
}

export function Badge({ tone, children }: { tone: "green" | "amber" | "red" | "navy" | "grey"; children: React.ReactNode }) {
  return <span className={`${styles.badge} ${styles[tone]}`}>{children}</span>;
}

export function SandboxNote() {
  return (
    <p className={styles.sandbox} role="note">
      Sandbox payments — this environment uses a test payment provider. No real money moves.
    </p>
  );
}

export function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}

export function JobCard({ job }: { job: WorkJobCardDto }) {
  return (
    <Link href={`/work/jobs/${job.id}`} className={styles.jobCard} aria-label={`${job.title}, ${money(job.payPerWorkerPaise)}`}>
      <div className={styles.jobHead}>
        <div className={styles.rowMain}>
          <span className={styles.meta}>{job.categoryName}</span>
          <span className={styles.jobTitle}>{job.title}</span>
          <span className={styles.meta}>
            {job.employer.displayName} {job.employer.verified && <Badge tone="green">✓ Verified</Badge>}
          </span>
        </div>
        <div>
          <div className={styles.pay}>{money(job.payPerWorkerPaise)}</div>
          <div className={styles.payNote}>{PAY_TYPE_LABEL[job.payType]}</div>
        </div>
      </div>
      <div className={styles.facts}>
        <span>📍 {job.locationType === "REMOTE" ? "Remote" : [job.locality, job.city].filter(Boolean).join(", ")}</span>
        <span>🗓 {when(job.startsAt)}</span>
        <span>⏱ {hoursBetween(job.startsAt, job.endsAt)}</span>
      </div>
      <div className={styles.chips}>
        <Badge tone={job.slotsLeft > 0 ? "navy" : "grey"}>{job.slotsLeft > 0 ? `${job.slotsLeft} of ${job.positions} places left` : "Full"}</Badge>
        <Badge tone="grey">{job.hiringMode === "INSTANT_ACCEPT" ? "Instant accept" : "Apply & get selected"}</Badge>
        {job.funded && <Badge tone="green">Pay funded</Badge>}
        {job.minVerificationLevel > 1 && <Badge tone="amber">Verified workers only</Badge>}
        {job.requiredSkills.slice(0, 3).map((s) => (
          <span key={s} className={styles.chip}>
            {s}
          </span>
        ))}
      </div>
    </Link>
  );
}

/** Private evidence photo, fetched with the session and shown from a short-lived object URL. */
export function EvidenceThumb({ fileId, admin = false }: { fileId: string; admin?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    apiFetchBlob(`work/${admin ? "admin/evidence" : "evidence"}/${fileId}`)
      .then(({ blob }) => {
        revoke = URL.createObjectURL(blob);
        setUrl(revoke);
      })
      .catch(() => setUrl(null));
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [fileId, admin]);
  // eslint-disable-next-line @next/next/no-img-element -- private blob URL, not optimisable by next/image
  return url ? <img src={url} alt="Uploaded evidence" style={{ maxWidth: 220, borderRadius: 10, border: "1px solid var(--bc-border)" }} /> : <span className={styles.meta}>Loading photo…</span>;
}

