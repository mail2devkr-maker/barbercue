"use client";

import Link from "next/link";
import { httpHrRegisterApi, type HrRegisterApi } from "../../lib/hr-register/api";
import OfferComposer from "./OfferComposer";
import RegisterGate from "./RegisterGate";
import styles from "./hr-register.module.css";

/**
 * The Offer Letter section of the CRM control center. Offers are saved to the permanent register
 * before any PDF exists; the former free-text employee number field is gone.
 */
export default function OfferLetterWorkspace({ api = httpHrRegisterApi }: { api?: HrRegisterApi }) {
  return (
    <RegisterGate api={api}>
      <OfferComposer api={api} />
      <p className={styles.muted} style={{ margin: "-6px 0 18px" }}>
        Search past candidates, offer versions, PDF history and the audit trail in the{" "}
        <Link href="/dashboard/admin/hr" style={{ color: "#ffb7c9" }}>Offer Letter &amp; Employee Register</Link>.
      </p>
    </RegisterGate>
  );
}
