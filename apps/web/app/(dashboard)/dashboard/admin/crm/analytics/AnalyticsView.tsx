"use client";

import { useEffect, useMemo, useState } from "react";
import { CrmErrorCode, Role } from "@barbercue/shared";
import type { AdminCrmAnalyticsDto, AdminCrmFollowUpDto, AdminCrmLeadDto, AdminCrmVisitDto } from "@barbercue/shared";
import { ApiError, apiFetch } from "../../../../../../lib/api";
import { useAuth } from "../../../../../../lib/auth-context";
import { LinkButton } from "../../../../../../components/ui/Button";
import { useCursorList } from "../../../../../../lib/use-cursor-list";
import {
  ALL,
  DETAIL_PATHS,
  EMPTY_DETAIL_FILTER,
  FOLLOW_UP_CHANNELS,
  FOLLOW_UP_STATUSES,
  LEAD_SOURCES,
  LEAD_STATUSES,
  RANGE_PRESETS,
  SORT_OPTIONS,
  VISIT_OUTCOMES,
  adminCrmErrorText,
  adminCrmFailureText,
  analyticsQuery,
  analyticsRange,
  countText,
  detailParams,
  localText,
  percentText,
  presetDays,
  pretty,
  sortRows,
  territoryLabel,
  totalConversion,
  utcText,
  type AnalyticsRange,
  type DetailFilter,
  type DetailKind,
  type RangePresetId,
  type SortKey,
} from "../../../../../../lib/admin-crm-analytics";
import styles from "../../admin.module.css";
import local from "./analytics.module.css";

interface KnownEmployee {
  id: string;
  code: string;
  territory: string | null;
}

const LIST_OPTIONS = {
  mismatchCodes: [CrmErrorCode.ADMIN_CURSOR_INVALID] as readonly string[],
  errorText: adminCrmErrorText,
  keyOf: (row: { id: string }) => row.id,
};

interface Metric {
  label: string;
  value: string;
  note: string;
}

function totalsCards(data: AdminCrmAnalyticsDto): Metric[] {
  const t = data.totals;
  return [
    { label: "Leads created", value: countText(t.leadsCreated), note: "Leads whose creation time is in the period." },
    {
      label: "Onboarded from these leads",
      value: countText(t.onboardedFromPeriodLeads),
      note: `${percentText(totalConversion(t.onboardedFromPeriodLeads, t.leadsCreated))} of the leads created. Counted as they stand now, not at the end of the period.`,
    },
    { label: "Onboarded in the period", value: countText(t.leadsOnboardedInPeriod), note: "Leads that are onboarded now and were onboarded in the period." },
    { label: "Visits", value: countText(t.visits), note: "Recorded visits with a visit time in the period." },
    { label: "Follow-ups completed", value: countText(t.followUpsCompleted), note: "Follow-ups completed in the period." },
    {
      label: "Open follow-ups overdue",
      value: countText(t.openFollowUpsOverdueInPeriod),
      note: "Still open, due in the period and already past due when this was generated.",
    },
  ];
}

export default function AnalyticsView() {
  const { user } = useAuth();
  const isPlatformAdmin = !!user && user.roles.includes(Role.PLATFORM_ADMIN);

  const initial = useMemo(() => presetDays("30d", new Date()), []);
  const [preset, setPreset] = useState<RangePresetId | "custom">("30d");
  const [fromDay, setFromDay] = useState(initial.from);
  const [toDay, setToDay] = useState(initial.to);
  const [employeeId, setEmployeeId] = useState(ALL);
  const [known, setKnown] = useState<KnownEmployee[]>([]);
  const [sort, setSort] = useState<SortKey>("name");
  const [data, setData] = useState<AdminCrmAnalyticsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const range = useMemo(() => analyticsRange(fromDay, toDay), [fromDay, toDay]);
  const query = range.ok ? analyticsQuery(range.range, employeeId) : null;

  useEffect(() => {
    if (!isPlatformAdmin || query === null) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const result = await apiFetch<AdminCrmAnalyticsDto>(`admin/crm/analytics?${query}`);
        if (cancelled) return;
        setData(result);
        // The employee choices come from an unfiltered answer, so narrowing to one employee never empties the list.
        if (new URLSearchParams(query).get("employeeId") === null) {
          setKnown(result.employees.map((e) => ({ id: e.employeeId, code: e.employeeCode, territory: e.territory })));
        }
      } catch (err) {
        if (cancelled) return;
        setData(null);
        setError(
          err instanceof ApiError
            ? adminCrmFailureText(err.status, err.code, err.message, "Could not load CRM analytics.")
            : "Could not load CRM analytics.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isPlatformAdmin, query, attempt]);

  const employees = useMemo(() => (data ? sortRows(data.employees, sort, (row) => row.employeeCode) : []), [data, sort]);
  const territories = useMemo(() => (data ? sortRows(data.territories, sort, (row) => (row.territory && row.territory.trim() ? row.territory : null)) : []), [data, sort]);

  function choosePreset(id: RangePresetId) {
    const days = presetDays(id, new Date());
    setPreset(id);
    setFromDay(days.from);
    setToDay(days.to);
  }

  if (!user) return null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Platform admin · read only</p>
          <h1>CRM analytics</h1>
          <p>Field-sales results by employee and territory, from the platform CRM.</p>
        </div>
        <div className={styles.headerActions}>
          <LinkButton href="/dashboard/admin/crm" variant="outline">CRM control center</LinkButton>
          <LinkButton href="/dashboard/admin" variant="outline">Platform operations</LinkButton>
        </div>
      </header>

      {!isPlatformAdmin ? (
        <p className={styles.error} role="alert">Only platform admins can see CRM analytics.</p>
      ) : (
        <>
          <section className={`${styles.filters} ${local.bar}`} aria-label="Analytics period and employee">
            <div>
              <span id="crm-presets-label" className={local.sub}>Period (whole UTC days)</span>
              <div className={local.presets} role="group" aria-labelledby="crm-presets-label">
                {RANGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${local.preset} ${preset === p.id ? local.presetActive : ""}`}
                    aria-pressed={preset === p.id}
                    onClick={() => choosePreset(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="crm-from">From</label>
              <input id="crm-from" type="date" value={fromDay} max="2999-12-31" onChange={(e) => { setPreset("custom"); setFromDay(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="crm-to">To (included)</label>
              <input id="crm-to" type="date" value={toDay} max="2999-12-31" onChange={(e) => { setPreset("custom"); setToDay(e.target.value); }} />
            </div>
            <div>
              <label htmlFor="crm-employee">Employee</label>
              <select id="crm-employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value={ALL}>All employees</option>
                {known.map((e) => (
                  <option key={e.id} value={e.id}>{e.code}{e.territory ? ` · ${e.territory}` : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="crm-sort">Sort tables by</label>
              <select id="crm-sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
          </section>
          {!range.ok && <p className={local.problem} role="alert">{range.problem}</p>}

          <details className={local.defs}>
            <summary>How these numbers are counted</summary>
            <ul>
              <li>A period is whole days in UTC, from 00:00 UTC on the first day up to, but not including, 00:00 UTC on the day after the last. The browser&apos;s time zone is not used.</li>
              <li>Conversion is the leads created in the period that are onboarded now, divided by the leads created in the period. It is today&apos;s state of those leads, not the rate at the end of the period.</li>
              <li>Overdue counts follow-ups that are still open, were due inside the period and were already past due when the figures were generated.</li>
              <li>These figures hold no names, phone numbers, emails or notes: an employee is shown by code and territory only.</li>
            </ul>
          </details>

          {loading && range.ok && <p className={styles.loading}>Loading analytics…</p>}
          {error && (
            <p className={styles.error} role="alert">
              {error}
              <button type="button" className={`${local.more} ${local.retry}`} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            </p>
          )}

          {!loading && !error && data && range.ok && (
            <>
              <p className={local.period}>
                Period {utcText(data.from)} to {utcText(data.to)} (the end is not included) · generated {utcText(data.generatedAt)}
              </p>
              <section className={styles.metrics} aria-label="Totals for the period">
                {totalsCards(data).map((m) => (
                  <article key={m.label} className={local.counter}>
                    <strong>{m.value}</strong>
                    <span>{m.label}</span>
                    <small>{m.note}</small>
                  </article>
                ))}
              </section>

              <section className={styles.section} aria-labelledby="crm-employees-title">
                <div className={styles.sectionHeader}>
                  <h2 id="crm-employees-title">By employee</h2>
                  <span>{employees.length} employee{employees.length === 1 ? "" : "s"}</span>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>Territory</th>
                        <th>Leads</th>
                        <th>Onboarded (these leads)</th>
                        <th>Conversion</th>
                        <th>Onboarded in period</th>
                        <th>Visits</th>
                        <th>Follow-ups done</th>
                        <th>Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employees.map((e) => (
                        <tr key={e.employeeId}>
                          <td><strong>{e.employeeCode}</strong><small>{pretty(String(e.status))}</small></td>
                          <td>{territoryLabel(e.territory)}</td>
                          <td>{countText(e.leadsCreated)}</td>
                          <td>{countText(e.onboardedFromPeriodLeads)}</td>
                          <td>{percentText(e.conversionPercent)}</td>
                          <td>{countText(e.leadsOnboardedInPeriod)}</td>
                          <td>{countText(e.visits)}</td>
                          <td>{countText(e.followUpsCompleted)}</td>
                          <td>{countText(e.openFollowUpsOverdueInPeriod)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {employees.length === 0 && <p className={styles.empty}>No field employees to show for this selection.</p>}
              </section>

              <section className={styles.section} aria-labelledby="crm-territories-title">
                <div className={styles.sectionHeader}>
                  <h2 id="crm-territories-title">By territory</h2>
                  <span>{territories.length} territor{territories.length === 1 ? "y" : "ies"}</span>
                </div>
                <div className={styles.tableWrap}>
                  <table>
                    <thead>
                      <tr>
                        <th>Territory</th>
                        <th>Employees</th>
                        <th>Leads</th>
                        <th>Onboarded (these leads)</th>
                        <th>Conversion</th>
                        <th>Onboarded in period</th>
                        <th>Visits</th>
                        <th>Follow-ups done</th>
                        <th>Overdue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {territories.map((t) => (
                        <tr key={t.territory ?? "__none__"}>
                          <td><strong>{territoryLabel(t.territory)}</strong></td>
                          <td>{countText(t.employees)}</td>
                          <td>{countText(t.leadsCreated)}</td>
                          <td>{countText(t.onboardedFromPeriodLeads)}</td>
                          <td>{percentText(t.conversionPercent)}</td>
                          <td>{countText(t.leadsOnboardedInPeriod)}</td>
                          <td>{countText(t.visits)}</td>
                          <td>{countText(t.followUpsCompleted)}</td>
                          <td>{countText(t.openFollowUpsOverdueInPeriod)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {territories.length === 0 && <p className={styles.empty}>No territories to show for this selection.</p>}
              </section>
            </>
          )}

          <DetailSection range={range.ok ? range.range : null} employeeId={employeeId} />

          <p className={local.readOnly}>This screen only reads. It has no export and sends no messages.</p>
        </>
      )}
    </main>
  );
}

const KINDS: ReadonlyArray<{ kind: DetailKind; label: string }> = [
  { kind: "leads", label: "Leads" },
  { kind: "visits", label: "Visits" },
  { kind: "follow-ups", label: "Follow-ups" },
];

/** The leads, visits and follow-ups behind the numbers, paged with the server's signed cursor. */
function DetailSection({ range, employeeId }: { range: AnalyticsRange | null; employeeId: string }) {
  const [kind, setKind] = useState<DetailKind>("leads");
  const [inPeriod, setInPeriod] = useState(true);
  const [draft, setDraft] = useState<DetailFilter>(EMPTY_DETAIL_FILTER);
  const [applied, setApplied] = useState<DetailFilter>(EMPTY_DETAIL_FILTER);

  // The server is asked only after the admin pauses typing.
  useEffect(() => {
    const timer = setTimeout(() => setApplied(draft), 400);
    return () => clearTimeout(timer);
  }, [draft]);

  function chooseKind(next: DetailKind) {
    setKind(next);
    const cleared = { ...EMPTY_DETAIL_FILTER, search: draft.search };
    setDraft(cleared);
    setApplied(cleared);
  }

  return (
    <section className={styles.section} aria-labelledby="crm-detail-title">
      <div className={styles.sectionHeader}>
        <h2 id="crm-detail-title">Rows behind the numbers</h2>
        <span>Platform admins only. Contact details are shown.</span>
      </div>
      <div className={local.tabs} role="group" aria-label="Kind of row">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            type="button"
            className={`${local.tab} ${kind === k.kind ? local.tabActive : ""}`}
            aria-pressed={kind === k.kind}
            onClick={() => chooseKind(k.kind)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <label className={local.checkRow} htmlFor="crm-in-period">
        <input id="crm-in-period" type="checkbox" checked={inPeriod} onChange={(e) => setInPeriod(e.target.checked)} />
        Only rows in the period above ({kind === "leads" ? "created" : kind === "visits" ? "visited" : "due"} in that period)
      </label>
      <div className={`${styles.filters} ${local.bar}`} role="search" aria-label="Filter rows">
        <div>
          <label htmlFor="crm-detail-search">Search</label>
          <input
            id="crm-detail-search"
            type="search"
            value={draft.search}
            maxLength={120}
            onChange={(e) => setDraft((d) => ({ ...d, search: e.target.value }))}
            placeholder={kind === "leads" ? "Shop, city or locality" : "Shop name"}
          />
        </div>
        {kind === "leads" && (
          <>
            <FilterSelect id="crm-detail-status" label="Stage" value={draft.status} values={LEAD_STATUSES} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
            <FilterSelect id="crm-detail-source" label="Source" value={draft.source} values={LEAD_SOURCES} onChange={(v) => setDraft((d) => ({ ...d, source: v }))} />
          </>
        )}
        {kind === "visits" && (
          <FilterSelect id="crm-detail-outcome" label="Outcome" value={draft.outcome} values={VISIT_OUTCOMES} onChange={(v) => setDraft((d) => ({ ...d, outcome: v }))} />
        )}
        {kind === "follow-ups" && (
          <>
            <FilterSelect id="crm-detail-fstatus" label="Status" value={draft.status} values={FOLLOW_UP_STATUSES} onChange={(v) => setDraft((d) => ({ ...d, status: v }))} />
            <FilterSelect id="crm-detail-channel" label="Channel" value={draft.channel} values={FOLLOW_UP_CHANNELS} onChange={(v) => setDraft((d) => ({ ...d, channel: v }))} />
          </>
        )}
      </div>
      {inPeriod && range === null ? (
        <p className={styles.empty}>Fix the dates above to list rows in that period, or untick the box to list every row.</p>
      ) : (
        <DetailList key={kind} kind={kind} filter={applied} range={inPeriod ? range : null} employeeId={employeeId} />
      )}
    </section>
  );
}

function FilterSelect({ id, label, value, values, onChange }: { id: string; label: string; value: string; values: readonly string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ALL}>All</option>
        {values.map((v) => <option key={v} value={v}>{pretty(v)}</option>)}
      </select>
    </div>
  );
}

type Row = AdminCrmLeadDto | AdminCrmVisitDto | AdminCrmFollowUpDto;

function DetailList({ kind, filter, range, employeeId }: { kind: DetailKind; filter: DetailFilter; range: AnalyticsRange | null; employeeId: string }) {
  const params = useMemo(() => detailParams(kind, filter, range, employeeId), [kind, filter, range, employeeId]);
  const list = useCursorList<Row>(DETAIL_PATHS[kind], params, true, LIST_OPTIONS);
  // "Overdue" is judged against the moment this list was opened, so a row never flips while it is being read.
  const [now] = useState(() => Date.now());
  const failure = list.errorStatus === 401 || list.errorStatus === 403 ? adminCrmFailureText(list.errorStatus, undefined, "", "") : list.error;

  return (
    <>
      {list.notice && <p className={local.notice} role="status">{list.notice}</p>}
      {failure && (
        <p className={styles.error} role="alert">
          {failure}
          {list.items.length === 0 && <button type="button" className={`${local.more} ${local.retry}`} onClick={list.reload}>Try again</button>}
        </p>
      )}
      {list.loading ? (
        <p className={styles.loading}>Loading…</p>
      ) : (
        <>
          <div className={styles.tableWrap}>
            {kind === "leads" && <LeadsTable rows={list.items as AdminCrmLeadDto[]} />}
            {kind === "visits" && <VisitsTable rows={list.items as AdminCrmVisitDto[]} />}
            {kind === "follow-ups" && <FollowUpsTable rows={list.items as AdminCrmFollowUpDto[]} now={now} />}
          </div>
          {list.items.length === 0 && !failure && <p className={styles.empty}>No rows match these filters.</p>}
          <div className={local.moreRow}>
            <span className={styles.empty}>{list.items.length} shown{list.hasMore ? ", more available" : ""}</span>
            {list.hasMore && (
              <button type="button" className={local.more} onClick={list.loadMore} disabled={list.loadingMore}>
                {list.loadingMore ? "Loading…" : "Show more"}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function who(e: { employeeCode: string; fullName: string }) {
  return <><strong>{e.employeeCode}</strong><small>{e.fullName}</small></>;
}

function LeadsTable({ rows }: { rows: AdminCrmLeadDto[] }) {
  return (
    <table>
      <thead><tr><th>Shop</th><th>Employee</th><th>Contact</th><th>Location</th><th>Stage</th><th>Onboarded shop</th><th>Created</th></tr></thead>
      <tbody>
        {rows.map((lead) => (
          <tr key={lead.id}>
            <td><strong>{lead.shopName}</strong><small>{pretty(lead.source)}</small></td>
            <td>{who(lead.employee)}</td>
            <td>{lead.contactName ?? "—"}<small>{lead.phone ?? lead.email ?? "No contact"}</small></td>
            <td>{[lead.locality, lead.city].filter(Boolean).join(", ") || "—"}</td>
            <td><span className={styles.status}>{pretty(lead.status)}</span></td>
            <td>{lead.onboardedSalon ? <><strong>{lead.onboardedSalon.publicId}</strong><small>{lead.onboardedSalon.name}</small></> : "—"}</td>
            <td>{localText(lead.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VisitsTable({ rows }: { rows: AdminCrmVisitDto[] }) {
  return (
    <table>
      <thead><tr><th>Visited</th><th>Shop</th><th>Employee</th><th>Outcome</th></tr></thead>
      <tbody>
        {rows.map((visit) => (
          <tr key={visit.id}>
            <td>{localText(visit.visitedAt)}</td>
            <td><strong>{visit.shopName}</strong>{visit.leadShopName && visit.leadShopName !== visit.shopName && <small>Lead: {visit.leadShopName}</small>}</td>
            <td>{who(visit.employee)}</td>
            <td><span className={styles.status}>{pretty(visit.outcome)}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FollowUpsTable({ rows, now }: { rows: AdminCrmFollowUpDto[]; now: number }) {
  return (
    <table>
      <thead><tr><th>Due</th><th>Shop</th><th>Employee</th><th>Channel</th><th>Status</th><th>Completed</th></tr></thead>
      <tbody>
        {rows.map((f) => {
          const overdue = f.status === "OPEN" && Date.parse(f.dueAt) < now;
          return (
            <tr key={f.id}>
              <td>{localText(f.dueAt)}</td>
              <td><strong>{f.leadShopName}</strong></td>
              <td>{who(f.employee)}</td>
              <td>{pretty(f.channel)}</td>
              <td>
                <span className={`${styles.status} ${overdue ? local.overdue : ""}`}>{overdue ? "Overdue" : pretty(f.status)}</span>
              </td>
              <td>{f.completedAt ? localText(f.completedAt) : "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
