"use client";

import { CrmTasks } from "../../../../components/crm/CrmActivity";
import { CrmShell } from "../../../../components/crm/CrmShell";

export default function EmployeeTasksPage() {
  return (
    <CrmShell title="Tasks" eyebrow="FastQue / Activity">
      <CrmTasks />
    </CrmShell>
  );
}
