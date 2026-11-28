"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Banner, PageHead, Skeleton, Tabs } from "../../owner/parts";
import ui from "../../owner/owner.module.css";
import { FinanceExpenses } from "./FinanceExpenses";
import { FinanceFunding } from "./FinanceFunding";
import { FinanceOverview } from "./FinanceOverview";
import { FinanceReimbursements } from "./FinanceReimbursements";
import { FinanceSettings } from "./FinanceSettings";
import { FinanceVendors } from "./FinanceVendors";
import { useFinanceMe } from "./finance-ui";

type TabId = "overview" | "expenses" | "funding" | "reimbursements" | "vendors" | "settings";
const ALL_TABS: ReadonlyArray<{ id: TabId; label: string; company: boolean }> = [
  { id: "overview", label: "Overview", company: true },
  { id: "expenses", label: "Expenses", company: false },
  { id: "funding", label: "Contributions & Funding", company: true },
  { id: "reimbursements", label: "Reimbursements", company: false },
  { id: "vendors", label: "Vendors & Payments", company: true },
  { id: "settings", label: "Settings & Categories", company: true },
];

/**
 * Admin → Finance. Company-wide tabs (overview, funding, vendors, settings) only for roles the
 * server allows to see company finance; everyone else sees their own expenses and claims.
 */
export function AdminFinance() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { me, error } = useFinanceMe();
  const tabs = ALL_TABS.filter((t) => !t.company || me?.roles.viewCompany);
  const requested = (params.get("tab") ?? "overview") as TabId;
  const tab: TabId = tabs.some((t) => t.id === requested) ? requested : (tabs[0]?.id ?? "expenses");
  const go = (t: TabId) => router.replace(`${pathname}${t === "overview" ? "" : `?tab=${t}`}`);

  return (
    <main className={ui.grid} aria-labelledby="finance-title">
      <PageHead
        eyebrow="Finance"
        title={me && !me.roles.viewCompany ? "My expenses & claims" : "Finance dashboard"}
        sub={
          me && !me.roles.viewCompany
            ? "Record what you spent for FastQue, attach receipts and track your reimbursements."
            : "Track expenses, contributions, reimbursements, vendor payments and cash position — every figure comes from recorded transactions."
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {!me ? (
        <Skeleton height={240} />
      ) : (
        <>
          <Tabs label="Finance sections" tabs={tabs} value={tab} onChange={go} />
          {tab === "overview" && <FinanceOverview onNavigate={go} />}
          {tab === "expenses" && <FinanceExpenses me={me} />}
          {tab === "funding" && <FinanceFunding me={me} />}
          {tab === "reimbursements" && <FinanceReimbursements me={me} />}
          {tab === "vendors" && <FinanceVendors me={me} />}
          {tab === "settings" && <FinanceSettings me={me} />}
        </>
      )}
    </main>
  );
}
