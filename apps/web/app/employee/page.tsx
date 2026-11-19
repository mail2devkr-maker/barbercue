"use client";

import { CrmDashboard } from "../../components/crm/CrmDashboard";
import { CrmShell } from "../../components/crm/CrmShell";

export default function EmployeeCrmDashboardPage() {
  return (
    <CrmShell title="Dashboard" sub="Your pipeline, calls, meetings and onboarding at a glance.">
      <CrmDashboard />
    </CrmShell>
  );
}
