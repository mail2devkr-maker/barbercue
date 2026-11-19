"use client";

import { CrmMeetings } from "../../../../components/crm/CrmActivity";
import { CrmShell } from "../../../../components/crm/CrmShell";

export default function EmployeeMeetingsPage() {
  return (
    <CrmShell title="Meetings" eyebrow="FastQue / Activity">
      <CrmMeetings />
    </CrmShell>
  );
}
