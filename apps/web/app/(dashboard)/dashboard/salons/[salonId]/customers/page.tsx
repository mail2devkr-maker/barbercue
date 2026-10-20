"use client";

import { use, useState } from "react";
import { CustomerDirectory } from "../../../../../../components/dashboard/CustomerDirectory";
import { LegacyCustomerList } from "../../../../../../components/dashboard/LegacyCustomerList";
import { OwnerOnly } from "../../../../../../components/owner/OwnerOnly";
import styles from "../../../../../../components/dashboard/dashboard.module.css";

/**
 * Owner customers (requirement #5): the server-side directory (search, type, sort and minimum visits answered by the server
 * for the whole shop). FastQue has no verified customer name, so customers are shown by their recorded phone or email and
 * nothing is inferred from anything else about them. If the server has no directory route yet, the earlier list is shown.
 */
export default function DashboardCustomersPage({ params }: { params: Promise<{ salonId: string }> }) {
  const { salonId } = use(params);
  const [legacy, setLegacy] = useState(false);
  return (
    <OwnerOnly>
    <main className={styles.page}>
      <h1 className={styles.pageTitle}>Customers</h1>
      <p className={styles.pageSubtitle}>
        Everyone who has booked or joined the Live Queue at your shop, with repeat and frequent markers based on completed visits here.
        FastQue has no verified customer name yet, so customers appear by their recorded phone or email. Recorded spend is only what
        your shop recorded in FastQue, after recorded refunds.
      </p>
      {legacy ? <LegacyCustomerList salonId={salonId} /> : <CustomerDirectory salonId={salonId} onRouteMissing={() => setLegacy(true)} />}
    </main>
    </OwnerOnly>
  );
}
