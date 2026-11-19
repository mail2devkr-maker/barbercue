"use client";

import { CrmShell } from "../../../components/crm/CrmShell";
import { CrmSupport } from "../../../components/crm/CrmSupport";

export default function EmployeeSupportPage() {
  return (
    <CrmShell title="Support" sub="Raise and follow issues with the app, salons or field operations.">
      <CrmSupport />
    </CrmShell>
  );
}
