"use client";

import { LinkButton } from "../../../../../components/ui/Button";
import HrWorkbench from "../../../../../components/hr/HrWorkbench";
import styles from "../admin.module.css";

export default function AdminHrRegisterPage() {
  return (
    <main className={styles.page} aria-label="Offer Letter and Employee Register">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FastQue HR</p>
          <h1>Offer letters &amp; employee register</h1>
          <p>
            One permanent employee ID per person — issued on the first saved offer, reused for every later offer and rehire.
          </p>
        </div>
        <div className={styles.headerActions}>
          <LinkButton href="/dashboard/admin/employees" variant="outline">Employees</LinkButton>
          <LinkButton href="/dashboard/admin/crm" variant="outline">Field CRM</LinkButton>
          <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
        </div>
      </header>
      <HrWorkbench />
    </main>
  );
}
