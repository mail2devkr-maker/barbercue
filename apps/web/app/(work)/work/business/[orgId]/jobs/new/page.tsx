"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { RequireRole } from "../../../../../../../components/auth/RequireRole";
import { WorkNav } from "../../../../WorkUi";
import { JobForm } from "../../../JobForm";
import styles from "../../../../work.module.css";

export default function NewJobPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const router = useRouter();
  return (
    <RequireRole redirectTo="/login">
      <main className={`${styles.page} ${styles.narrow}`}>
        <WorkNav />
        <Link href="/work/business" className={styles.meta}>
          ← Business
        </Link>
        <div>
          <h1 className={styles.title}>Post a job</h1>
          <p className={styles.sub}>You’ll see a full preview and the exact amount to fund before anything is published.</p>
        </div>
        <JobForm orgId={orgId} onSaved={(job) => router.push(`/work/business/${orgId}/jobs/${job.id}`)} />
      </main>
    </RequireRole>
  );
}
