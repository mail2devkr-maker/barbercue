"use client";

import { CrmNotifications } from "../../../components/crm/CrmAnalytics";
import { CrmShell } from "../../../components/crm/CrmShell";

export default function EmployeeNotificationsPage() {
  return (
    <CrmShell title="Notifications">
      <CrmNotifications />
    </CrmShell>
  );
}
