"use client";

import { CrmCalls } from "../../../../components/crm/CrmActivity";
import { CrmShell } from "../../../../components/crm/CrmShell";

export default function EmployeeCallsPage() {
  return (
    <CrmShell title="Calls" eyebrow="FastQue / Activity" sub="Your call queue. Dial from your phone, then log the outcome.">
      <CrmCalls />
    </CrmShell>
  );
}
