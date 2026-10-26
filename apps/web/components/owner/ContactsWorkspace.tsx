"use client";

import { useState } from "react";
import { isSandbox } from "../../lib/capabilities";
import { useCapabilities } from "../../lib/use-capabilities";
import { ContactLedgerPanel } from "./ContactLedgerPanel";
import { ContactListCheck } from "./ContactListCheck";
import { BtnLink, Card } from "./parts";
import ui from "./owner.module.css";

/**
 * The contacts page: the list check always, and the agreement-record tools only when the server says the ledger is switched
 * on for this environment (contactImport = SANDBOX). While capabilities load, or if they cannot be read, the page behaves
 * exactly as before: a check only.
 */
export function ContactsWorkspace({ salonId }: { salonId: string }) {
  const capabilities = useCapabilities(salonId);
  const ledgerEnabled = capabilities.phase === "ready" && isSandbox(capabilities.features, "contactImport");
  // Saving records in the check below changes the counts shown in the panel, so the panel reads them again.
  const [saves, setSaves] = useState(0);
  return (
    <>
      <div className={ui.mt16}>
        <Card title="Invite people your own way" sub="FastQue does not send invitations. Share your shop's public link or QR code yourself, to people who have agreed to hear from you.">
          <BtnLink href={`/dashboard/salons/${salonId}/marketing`}>Open your shop link and QR code</BtnLink>
        </Card>
      </div>
      <ContactListCheck salonId={salonId} ledgerEnabled={ledgerEnabled} onSaved={() => setSaves((n) => n + 1)} />
      {ledgerEnabled && <ContactLedgerPanel salonId={salonId} refreshKey={saves} />}
    </>
  );
}
