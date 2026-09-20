"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EMPLOYEE_PATHS,
  Role,
  type EmployeeProfileDto,
} from "@barbercue/shared";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { SiteFooter } from "../../components/layout/SiteFooter";
import { BrandLockup } from "../../components/ui/BrandLockup";
import styles from "./employee.module.css";

function EmployeePageFrame({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}

export default function EmployeeDashboardPage() {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState<EmployeeProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated" || !user?.roles.includes(Role.FIELD_EXECUTIVE)) {
      router.replace("/employee/login");
      return;
    }
    apiFetch<EmployeeProfileDto>(EMPLOYEE_PATHS.employee + "/" + EMPLOYEE_PATHS.me)
      .then(setProfile)
      .catch(() => setError("Could not load your employee profile. Please contact your FastQue administrator."));
  }, [router, status, user]);

  if (status === "loading" || !profile) {
    return (
      <EmployeePageFrame>
        <main className={styles.page}>
          <div className={styles.shell}>
            <p className={styles.eyebrow}>FastQue Field Operations</p>
            <h1 className={styles.title}>{error ? "Employee profile unavailable" : "Preparing your dashboard…"}</h1>
            {error && <p className={styles.error}>{error}</p>}
          </div>
        </main>
      </EmployeePageFrame>
    );
  }

  return (
    <EmployeePageFrame>
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topbar}>
          <div className={styles.brand}><BrandLockup compact canonicalArtwork /></div>
          <button
            type="button"
            className={styles.signout}
            onClick={() => void logout().then(() => router.replace("/employee/login"))}
          >
            Sign out
          </button>
        </div>

        <p className={styles.eyebrow}>Field Executive Dashboard</p>
        <h1 className={styles.title}>Welcome, {profile.fullName}.</h1>
        <p className={styles.sub}>
          This employee workspace is separate from customer and shop accounts. Your field visits,
          leads, follow-ups and shop onboarding activity will be attributed to this Employee ID.
        </p>

        <section className={styles.profile} aria-label="Employee profile">
          <div className={styles.card}><span className={styles.label}>Employee ID</span><span className={styles.value}>{profile.employeeCode}</span></div>
          <div className={styles.card}><span className={styles.label}>Name</span><span className={styles.value}>{profile.fullName}</span></div>
          <div className={styles.card}><span className={styles.label}>Territory</span><span className={styles.value}>{profile.territory ?? "Not assigned"}</span></div>
          <div className={styles.card}><span className={styles.label}>Joined</span><span className={styles.value}>{new Date(profile.joinedAt).toLocaleDateString("en-IN")}</span></div>
        </section>

        <section className={styles.next}>
          <h2>CRM foundation is ready.</h2>
          <p>
            The next CRM layer will add Visit Shop, Leads, Follow-ups, Onboard New Shop and the
            admin performance dashboard without mixing FastQue employees with salon staff.
          </p>
        </section>
      </div>
    </main>
    </EmployeePageFrame>
  );
}
