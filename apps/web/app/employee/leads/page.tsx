"use client";

import { CrmLeads } from "../../../components/crm/CrmLeads";
import { CrmShell } from "../../../components/crm/CrmShell";

export default function EmployeeLeadsPage() {
  return (
    <CrmShell title="Leads" sub="Every salon you are working, from first call to activation.">
      <CrmLeads />
    </CrmShell>
  );
}
