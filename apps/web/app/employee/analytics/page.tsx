"use client";

import { CrmAnalytics } from "../../../components/crm/CrmAnalytics";
import { CrmShell } from "../../../components/crm/CrmShell";

export default function EmployeeAnalyticsPage() {
  return (
    <CrmShell title="Analytics" sub="Your results over time. Every number is counted from your CRM records.">
      <CrmAnalytics />
    </CrmShell>
  );
}
