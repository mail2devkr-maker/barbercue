import { AssistantActionId } from '@barbercue/shared';
import { prettyDate } from './shop-ops.actions';
import { text, type HandlerMap } from './kit';

/**
 * Batch 6 (issue #362): a field employee's own CRM, read-only, through EmployeeService - which
 * scopes every query to the signed-in employee. The action itself also requires an EMPLOYEE-audience
 * session (checked before the handler runs), exactly like RolesGuard on the employee routes.
 * Phone numbers and notes are not read aloud; the employee screens show the full record.
 */

const ist = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const MAX = 8;

export const BATCH6_HANDLERS: HandlerMap = {
  [AssistantActionId.EMPLOYEE_DASHBOARD]: {
    async plan(c) {
      const d = await c.deps.employee.getDashboard(c.user.id);
      return {
        status: 'DONE',
        message: `${d.counts.leads} leads, ${d.counts.onboarded} onboarded (${d.conversionRatePercent}%).`,
        result: {
          summary: 'My field work',
          items: [
            { title: 'Leads', detail: String(d.counts.leads) },
            { title: 'Onboarded', detail: String(d.counts.onboarded) },
            {
              title: 'Visits (30 days)',
              detail: String(d.counts.visitsLast30Days),
            },
            {
              title: 'Open follow-ups',
              detail: String(d.counts.openFollowUps),
            },
            {
              title: 'Overdue follow-ups',
              detail: String(d.counts.overdueFollowUps),
            },
          ],
        },
        navigateTo: '/employee',
      };
    },
  },

  [AssistantActionId.EMPLOYEE_LEADS]: {
    async plan(c, p) {
      const status = text(p.status) || undefined;
      const leads = await c.deps.employee.listLeads(c.user.id, status);
      const label = status ? `${words(status)} leads` : 'leads';
      if (!leads.length)
        return {
          status: 'DONE',
          message: `You have no ${label}.`,
          navigateTo: '/employee',
        };
      return {
        status: 'DONE',
        message: `${leads.length} ${label}${leads.length > MAX ? `, latest ${MAX} shown` : ''}.`,
        result: {
          summary: `My ${label}`,
          items: leads.slice(0, MAX).map((l) => ({
            title: l.shopName,
            detail: [words(l.status), l.locality ?? l.city]
              .filter(Boolean)
              .join(' · '),
          })),
        },
        navigateTo: '/employee',
      };
    },
  },

  [AssistantActionId.EMPLOYEE_FOLLOW_UPS]: {
    async plan(c, p) {
      const open = await c.deps.employee.listFollowUps(c.user.id, 'OPEN');
      const now = Date.now();
      const rows = p.overdueOnly
        ? open.filter((f) => new Date(f.dueAt).getTime() < now)
        : open;
      const label = p.overdueOnly ? 'overdue follow-ups' : 'open follow-ups';
      if (!rows.length)
        return {
          status: 'DONE',
          message: `You have no ${label}.`,
          navigateTo: '/employee',
        };
      const sorted = [...rows].sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      return {
        status: 'DONE',
        message: `${rows.length} ${label}${rows.length > MAX ? `, first ${MAX} shown` : ''}.`,
        result: {
          summary: `My ${label}`,
          items: sorted.slice(0, MAX).map((f) => ({
            title: f.leadShopName,
            detail: `${new Date(f.dueAt).getTime() < now ? 'overdue · ' : ''}${ist(f.dueAt)} · ${words(f.channel)}`,
          })),
        },
        navigateTo: '/employee',
      };
    },
  },

  [AssistantActionId.EMPLOYEE_VISITS]: {
    async plan(c) {
      const visits = await c.deps.employee.listVisits(c.user.id);
      if (!visits.length)
        return {
          status: 'DONE',
          message: 'You have no visits logged yet.',
          navigateTo: '/employee',
        };
      return {
        status: 'DONE',
        message: `${visits.length} visits${visits.length > MAX ? `, latest ${MAX} shown` : ''}.`,
        result: {
          summary: 'My visits',
          items: visits.slice(0, MAX).map((v) => ({
            title: v.shopName,
            detail: `${prettyDate(v.visitedAt.slice(0, 10))} · ${words(v.outcome)}`,
          })),
        },
        navigateTo: '/employee',
      };
    },
  },
};
