"use client";

import Link from "next/link";
import { CrmShell } from "../../../components/crm/CrmShell";
import { EmployeeOnboardingTab } from "../../../components/onboarding/EmployeeOnboardingTab";
import s from "../../../components/crm/crm.module.css";

export default function EmployeeOnboardingListPage() {
  return (
    <CrmShell
      title="Salon onboarding"
      sub="Drafts, submissions and approvals. A salon goes live only after admin approval."
      actions={<Link href="/employee/onboarding/new" className={`${s.btn} ${s.btnPrimary}`}>+ Onboard a salon</Link>}
    >
      <EmployeeOnboardingTab />
    </CrmShell>
  );
}
