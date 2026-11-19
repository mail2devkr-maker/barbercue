"use client";

import { CrmProfile } from "../../../components/crm/CrmAnalytics";
import { CrmShell } from "../../../components/crm/CrmShell";

export default function EmployeeProfilePage() {
  return (
    <CrmShell title="My profile">
      <CrmProfile />
    </CrmShell>
  );
}
