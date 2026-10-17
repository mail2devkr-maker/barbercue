"use client";

import { useEffect, useState } from "react";
import { DASHBOARD_PATHS } from "@barbercue/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { isUsable, unavailableMessage } from "../../lib/capabilities";
import { useCapabilities } from "../../lib/use-capabilities";
import {
  DEMO_BANNER,
  SIMULATED_NOTE,
  chartPoints,
  minorText,
  nameOf,
  parseDemoStatus,
  parseDemoView,
  statusWord,
  type DemoView,
  type MoneyBreakdown,
} from "../../lib/demo-workspace";
import { BarChart, LineChart } from "./charts";
import { Badge, Banner, BtnLink, Card, EmptyState, Kpi, Skeleton, Tabs } from "./parts";
import ui from "./owner.module.css";

type Tab = "overview" | "revenue" | "customers" | "bookings" | "visits" | "services" | "staff" | "invoices" | "reviews";
type Period = "daily" | "weekly" | "monthly";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "customers", label: "Customers" },
  { id: "bookings", label: "Bookings" },
  { id: "visits", label: "Live Queue" },
  { id: "services", label: "Services" },
  { id: "staff", label: "Staff and chairs" },
  { id: "invoices", label: "Invoices" },
  { id: "reviews", label: "Reviews" },
];

function dateText(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function dateTimeText(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function visitTone(status: string): "ok" | "warn" | "bad" | "info" | "neutral" {
  if (status === "COMPLETED") return "ok";
  if (status === "CANCELLED" || status === "NO_SHOW") return "bad";
  if (status === "IN_SERVICE") return "info";
  return "warn";
}

/**
 * Read-only view of the Demo Workspace dataset. It never reads or writes real shop data, and the demo banner is outside
 * every tab, so it stays on screen for every demo view. Amounts are simulated projections, never recorded revenue.
 */
export function DemoDashboard({ salonId }: { salonId: string }) {
  const base = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/demo`;
  const shopHome = `/${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}`;
  const capabilities = useCapabilities(salonId);
  const usable = isUsable(capabilities.features, "demoData");

  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [view, setView] = useState<DemoView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [period, setPeriod] = useState<Period>("daily");

  useEffect(() => {
    if (!usable) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      try {
        const status = parseDemoStatus(await apiFetch<unknown>(`${base}/status`));
        if (!status.active || !status.workspaceId) {
          if (!cancelled) setPhase("none");
          return;
        }
        const parsed = parseDemoView(await apiFetch<unknown>(`${base}/workspaces/${status.workspaceId}`));
        if (cancelled) return;
        if (!parsed) {
          setError("The server sent demo data in a form this page cannot read. Nothing was changed.");
          setPhase("error");
          return;
        }
        setView(parsed);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not open your demo data.");
        setPhase("error");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [usable, base]);

  const back = (
    <BtnLink variant="secondary" href={shopHome}>
      Back to real shop
    </BtnLink>
  );

  if (capabilities.phase === "loading") return <Skeleton height={160} />;
  if (!usable) {
    return (
      <EmptyState title="Demo data is not available yet" action={back}>
        {unavailableMessage(capabilities.phase === "ready" ? capabilities.features : null, "demoData")} Nothing about your real shop is affected.
      </EmptyState>
    );
  }

  const bannerText = (
    <>
      <strong>{DEMO_BANNER}</strong> {SIMULATED_NOTE}
    </>
  );

  return (
    <div className={ui.mt16}>
      <div data-testid="demo-banner">
        <Banner tone="warn">{bannerText}</Banner>
      </div>
      <div className={`${ui.rowWrap} ${ui.mt12}`}>
        {back}
        <BtnLink variant="quiet" href={`${shopHome}/demo`}>
          Manage demo data
        </BtnLink>
      </div>

      {phase === "loading" && <div className={ui.mt12}><Skeleton height={220} /></div>}
      {phase === "none" && (
        <div className={ui.mt12}>
          <EmptyState title="You have no demo data right now">Add demo data from the Demo data page, then open it here.</EmptyState>
        </div>
      )}
      {phase === "error" && error && <div className={ui.mt12}><Banner tone="error">{error}</Banner></div>}
      {phase === "ready" && view && (
        <div className={ui.mt12}>
          <Tabs tabs={TABS} value={tab} onChange={setTab} label="Demo data sections" />
          <div className={ui.mt12} role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
            {tab === "overview" && <Overview view={view} />}
            {tab === "revenue" && <Revenue view={view} period={period} onPeriod={setPeriod} />}
            {tab === "customers" && <Customers view={view} />}
            {tab === "bookings" && <Bookings view={view} />}
            {tab === "visits" && <Visits view={view} />}
            {tab === "services" && <Services view={view} />}
            {tab === "staff" && <StaffAndChairs view={view} />}
            {tab === "invoices" && <Invoices view={view} />}
            {tab === "reviews" && <Reviews view={view} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Overview({ view }: { view: DemoView }) {
  const completed = view.visits.filter((v) => v.status === "COMPLETED");
  const estimated = completed.reduce((sum, v) => sum + v.estimatedValueMinor, 0);
  const collection = completed.reduce((sum, v) => sum + v.simulatedCollectionMinor, 0);
  const ratings = view.reviews.filter((r) => r.rating > 0);
  const average = ratings.length ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length : null;
  return (
    <>
      <div className={ui.kpiGrid}>
        <Kpi label="Customers (demo)" value={view.customers.length} icon="users" />
        <Kpi label="Bookings (demo)" value={view.bookings.length} icon="calendar" tone="info" />
        <Kpi label="Completed visits (demo)" value={completed.length} icon="queue" tone="ok" />
        <Kpi label="Estimated value (simulated)" value={minorText(estimated, view.currency)} foot={`Simulated collection ${minorText(collection, view.currency)}`} icon="rupee" tone="warn" />
        <Kpi label="Average rating (demo)" value={average === null ? "None yet" : average.toFixed(1)} icon="star" />
      </div>
      <p className={ui.cardSub}>
        Sample shop: {view.label}. Data was generated {view.generatedAt ? dateText(view.generatedAt) : "at an unknown time"}, times in {view.timezone}.
      </p>
    </>
  );
}

function Revenue({ view, period, onPeriod }: { view: DemoView; period: Period; onPeriod: (p: Period) => void }) {
  const rows = view.revenue[period];
  const format = (major: number) => minorText(Math.round(major * 100), view.currency);
  return (
    <>
      <Banner tone="info">{SIMULATED_NOTE}</Banner>
      <div className={ui.mt12}>
        <Tabs
          tabs={[
            { id: "daily" as Period, label: "Daily" },
            { id: "weekly" as Period, label: "Weekly" },
            { id: "monthly" as Period, label: "Monthly" },
          ]}
          value={period}
          onChange={onPeriod}
          label="Demo revenue period"
        />
      </div>
      {rows.length === 0 ? (
        <div className={ui.mt12}><EmptyState title="No demo figures for this period">The demo workspace has no simulated figures to chart here.</EmptyState></div>
      ) : (
        <div className={`${ui.twoCol} ${ui.mt12}`}>
          <Card title="Estimated value (simulated)">
            {period === "daily" ? (
              <LineChart points={chartPoints(rows, "estimated")} formatValue={format} ariaLabel="Simulated estimated value per day" />
            ) : (
              <BarChart points={chartPoints(rows, "estimated")} formatValue={format} ariaLabel={`Simulated estimated value per ${period === "weekly" ? "week" : "month"}`} />
            )}
          </Card>
          <Card title="Collection projection (simulated)">
            {period === "daily" ? (
              <LineChart points={chartPoints(rows, "collection")} formatValue={format} ariaLabel="Simulated collection projection per day" />
            ) : (
              <BarChart points={chartPoints(rows, "collection")} formatValue={format} ariaLabel={`Simulated collection projection per ${period === "weekly" ? "week" : "month"}`} />
            )}
          </Card>
        </div>
      )}
      <div className={`${ui.twoCol} ${ui.mt12}`}>
        <BreakdownTable title="By service" rows={view.revenue.byService} names={view.services} currency={view.currency} />
        <BreakdownTable title="By staff" rows={view.revenue.byStaff} names={view.staff} currency={view.currency} />
      </div>
      <div className={ui.mt12}>
        <BreakdownTable title="By customer" rows={view.revenue.byCustomer} names={view.customers} currency={view.currency} />
      </div>
    </>
  );
}

function BreakdownTable({ title, rows, names, currency }: { title: string; rows: MoneyBreakdown[]; names: ReadonlyArray<{ id: string; name: string }>; currency: string }) {
  return (
    <Card title={`${title} (simulated)`}>
      {rows.length === 0 ? (
        <p className={ui.cardSub}>No demo figures here.</p>
      ) : (
        <div className={ui.tableWrap}>
          <table className={ui.table}>
            <caption className={ui.cardSub}>{title}, simulated</caption>
            <thead><tr><th>Name</th><th className={ui.num}>Completed visits</th><th className={ui.num}>Estimated value</th><th className={ui.num}>Collection projection</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{nameOf(names, r.id)}</td>
                  <td className={ui.num}>{r.completedVisits}</td>
                  <td className={ui.num}>{minorText(r.estimatedValueMinor, currency)}</td>
                  <td className={ui.num}>{minorText(r.collectionProjectionMinor, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Table({ caption, head, children, empty }: { caption: string; head: string[]; children: React.ReactNode; empty: boolean }) {
  if (empty) return <EmptyState title={`No demo ${caption.toLowerCase()}`}>The demo workspace has none.</EmptyState>;
  return (
    <div className={ui.tableWrap}>
      <table className={ui.table}>
        <caption className={ui.cardSub}>{caption} (demo)</caption>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Customers({ view }: { view: DemoView }) {
  return (
    <Table caption="Customers" head={["Name", "Email", "First visit", "Last visit", "Visits"]} empty={view.customers.length === 0}>
      {view.customers.map((c) => (
        <tr key={c.id}><td>{c.name}</td><td>{c.email}</td><td>{dateText(c.firstVisitAt)}</td><td>{dateText(c.lastVisitAt)}</td><td className={ui.num}>{c.visitCount}</td></tr>
      ))}
    </Table>
  );
}

function Bookings({ view }: { view: DemoView }) {
  return (
    <Table caption="Bookings" head={["When", "Customer", "Services", "From", "Status"]} empty={view.bookings.length === 0}>
      {view.bookings.map((b) => (
        <tr key={b.id}>
          <td>{dateTimeText(b.slotStart)}</td>
          <td>{nameOf(view.customers, b.customerId)}</td>
          <td>{b.serviceIds.map((id) => nameOf(view.services, id)).join(", ")}</td>
          <td>{statusWord(b.source)}</td>
          <td><Badge tone={visitTone(b.status)}>{statusWord(b.status)}</Badge></td>
        </tr>
      ))}
    </Table>
  );
}

function Visits({ view }: { view: DemoView }) {
  return (
    <Table caption="Live Queue visits" head={["Joined", "Customer", "Service", "Staff", "Status", "Estimated value (simulated)"]} empty={view.visits.length === 0}>
      {view.visits.map((v) => (
        <tr key={v.id}>
          <td>{dateTimeText(v.joinedAt)}</td>
          <td>{v.customerName}</td>
          <td>{nameOf(view.services, v.serviceId)}</td>
          <td>{nameOf(view.staff, v.staffId)}</td>
          <td><Badge tone={visitTone(v.status)}>{statusWord(v.status)}</Badge></td>
          <td className={ui.num}>{minorText(v.estimatedValueMinor, view.currency)}</td>
        </tr>
      ))}
    </Table>
  );
}

function Services({ view }: { view: DemoView }) {
  return (
    <Table caption="Services" head={["Service", "Category", "Duration", "List price (simulated)"]} empty={view.services.length === 0}>
      {view.services.map((s) => (
        <tr key={s.id}><td>{s.name}</td><td>{s.category}</td><td className={ui.num}>{s.durationMinutes} min</td><td className={ui.num}>{minorText(s.listPriceMinor, view.currency)}</td></tr>
      ))}
    </Table>
  );
}

function StaffAndChairs({ view }: { view: DemoView }) {
  return (
    <div className={ui.twoCol}>
      <Table caption="Staff" head={["Name", "Role"]} empty={view.staff.length === 0}>
        {view.staff.map((s) => (
          <tr key={s.id}><td>{s.name}</td><td>{statusWord(s.role)}</td></tr>
        ))}
      </Table>
      <Table caption="Chairs" head={["Chair", "Status"]} empty={view.chairs.length === 0}>
        {view.chairs.map((c) => (
          <tr key={c.id}><td>{c.label}</td><td><Badge tone={c.status === "AVAILABLE" ? "ok" : "info"}>{statusWord(c.status)}</Badge></td></tr>
        ))}
      </Table>
    </div>
  );
}

function Invoices({ view }: { view: DemoView }) {
  return (
    <>
      <Banner tone="info">These invoices are simulated. None of them records a real payment.</Banner>
      <div className={ui.mt12}>
        <Table caption="Invoices" head={["Invoice", "Status", "Total (simulated)", "Collection projection"]} empty={view.invoices.length === 0}>
          {view.invoices.map((i, idx) => (
            <tr key={i.id}>
              <td>Demo invoice {idx + 1}</td>
              <td>{statusWord(i.status)}</td>
              <td className={ui.num}>{minorText(i.totalMinor, view.currency)}</td>
              <td className={ui.num}>{minorText(i.simulatedCollectionProjectionMinor, view.currency)}</td>
            </tr>
          ))}
        </Table>
      </div>
    </>
  );
}

function Reviews({ view }: { view: DemoView }) {
  return (
    <Table caption="Reviews" head={["Customer", "Rating", "Comment"]} empty={view.reviews.length === 0}>
      {view.reviews.map((r) => (
        <tr key={r.id}><td>{r.customerName}</td><td className={ui.num}>{r.rating} / 5</td><td>{r.comment}</td></tr>
      ))}
    </Table>
  );
}
