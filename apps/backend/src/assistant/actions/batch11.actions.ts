import { AssistantActionId } from '@barbercue/shared';
import {
  addZonedCalendarDays,
  utcToZonedDateStr,
} from '../../common/timezone/timezone';
import { prettyDate } from './shop-ops.actions';
import { rupees, type HandlerMap } from './kit';

/**
 * Batch 11 (issue #362): platform customer and staff analytics - the KPI figures only. The
 * per-customer and per-staff rows those services also return are never read out, so the assistant
 * never shows a person's details. Roles are ADMIN_PERMISSION_ROLES.viewCustomerAnalytics /
 * viewStaffAnalytics (the same constants the admin routes use) plus an ADMIN-audience session.
 */

const IST = 'Asia/Kolkata';
const pct = (v: number | null) => (v === null ? 'not tracked' : `${v}%`);
const num = (v: number | null) => (v === null ? 'not tracked' : String(v));

function range(daysRaw: unknown) {
  const days = [1, 7, 30].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
  const to = utcToZonedDateStr(new Date(), IST);
  const from = addZonedCalendarDays(to, -(days - 1));
  return {
    from,
    to,
    label: days === 1 ? 'today' : `${prettyDate(from)} – ${prettyDate(to)}`,
  };
}

export const BATCH11_HANDLERS: HandlerMap = {
  [AssistantActionId.ADMIN_CUSTOMER_ANALYTICS]: {
    async plan(c, p) {
      const r = range(p.days);
      const k = (
        await c.deps.customerAnalytics.getOverview({ from: r.from, to: r.to })
      ).kpis;
      return {
        status: 'DONE',
        message: `Customers, ${r.label}: ${k.activeCustomers} active, ${k.newCustomers} new, ${k.completedVisits} completed visits.`,
        result: {
          summary: `Customers, ${r.label}`,
          items: [
            { title: 'Active customers', detail: String(k.activeCustomers) },
            { title: 'New customers', detail: String(k.newCustomers) },
            {
              title: 'Returning customers',
              detail: String(k.returningCustomers),
            },
            { title: 'Completed visits', detail: String(k.completedVisits) },
            { title: 'Repeat rate', detail: pct(k.repeatRatePercent) },
            { title: 'No-show rate', detail: pct(k.noShowRatePercent) },
            {
              title: 'Average visit value',
              detail:
                k.averageVisitValuePaise === null
                  ? 'not tracked'
                  : rupees(k.averageVisitValuePaise / 100),
            },
          ],
        },
        navigateTo: '/dashboard/admin/customers',
      };
    },
  },

  [AssistantActionId.ADMIN_STAFF_ANALYTICS]: {
    async plan(c, p) {
      const r = range(p.days);
      const k = (
        await c.deps.staffAnalytics.getOverview({ from: r.from, to: r.to })
      ).kpis;
      return {
        status: 'DONE',
        message: `Staff, ${r.label}: ${k.activeStaff} active, ${k.servingNow} serving now, ${k.completedServices} services completed.`,
        result: {
          summary: `Staff, ${r.label}`,
          items: [
            { title: 'Active staff', detail: String(k.activeStaff) },
            { title: 'Shops with staff', detail: String(k.shopsWithStaff) },
            { title: 'Scheduled today', detail: String(k.scheduledToday) },
            { title: 'Serving now', detail: String(k.servingNow) },
            {
              title: 'Completed services',
              detail: String(k.completedServices),
            },
            {
              title: 'Average service minutes',
              detail: num(k.averageServiceMinutes),
            },
            { title: 'Utilization', detail: pct(k.utilizationPercent) },
          ],
        },
        navigateTo: '/dashboard/admin/staff',
      };
    },
  },
};
