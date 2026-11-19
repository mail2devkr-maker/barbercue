"use client";

import { CrmConversations } from "../../../components/crm/CrmConversations";
import { CrmShell } from "../../../components/crm/CrmShell";

export default function EmployeeConversationsPage() {
  return (
    <CrmShell title="Sales conversations" sub="Record pitches only with everyone's consent. Audio is private to you and your managers.">
      <CrmConversations />
    </CrmShell>
  );
}
