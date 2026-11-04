import { AssistantActionId } from '@barbercue/shared';
import { prettyDate } from './shop-ops.actions';
import { text, type HandlerMap } from './kit';

/**
 * Batch 7 (issue #362): platform reads that match the admin routes' own audiences exactly - the
 * verification queue (admin, co-founder) and the field-sales CRM overview (admin, co-founder, HR,
 * sales). Both need an ADMIN-audience (TOTP) session. Deciding a verification stays in the admin
 * screen (an owner-approved decision); submitter phone and email are never read out.
 */

const MAX = 8;
const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');

export const BATCH7_HANDLERS: HandlerMap = {
  [AssistantActionId.ADMIN_VERIFICATION_QUEUE]: {
    async plan(c, p) {
      const status = text(p.status) || 'SUBMITTED';
      const page = await c.deps.verification.list(
        status,
        undefined,
        String(MAX),
      );
      const label = `${words(status)} verification requests`;
      if (!page.items.length)
        return {
          status: 'DONE',
          message: `No ${label}.`,
          navigateTo: '/dashboard/admin/verification',
        };
      return {
        status: 'DONE',
        message: `${page.items.length}${page.nextCursor ? '+' : ''} ${label}, oldest first.`,
        result: {
          summary: `Verification: ${words(status)}`,
          items: page.items.map((v) => ({
            title:
              v.salonName ??
              (v.staffDisplayName
                ? `${v.staffDisplayName} · ${v.staffSalonName ?? ''}`
                : 'Unknown'),
            detail: `${v.subjectType === 'SHOP' ? 'Shop' : 'Professional'} · submitted ${prettyDate(v.submittedAt.slice(0, 10))}`,
          })),
        },
        navigateTo: '/dashboard/admin/verification',
      };
    },
  },

  [AssistantActionId.ADMIN_CRM_OVERVIEW]: {
    async plan(c) {
      const o = await c.deps.crm.getOverview();
      const top = [...o.performance]
        .sort((a, b) => b.onboarded - a.onboarded || b.leads - a.leads)
        .slice(0, MAX);
      return {
        status: 'DONE',
        message: `${o.counts.employees} field employees: ${o.counts.leads} leads, ${o.counts.onboarded} onboarded (${o.conversionRatePercent}%), ${o.counts.overdueFollowUps} follow-ups overdue.`,
        result: {
          summary: 'Field sales team',
          items: [
            {
              title: 'Visits (30 days)',
              detail: String(o.counts.visitsLast30Days),
            },
            {
              title: 'Open follow-ups',
              detail: String(o.counts.openFollowUps),
            },
            ...top.map((e) => ({
              title: e.employee.fullName,
              detail: `${e.leads} leads · ${e.onboarded} onboarded · ${e.overdueFollowUps} overdue`,
            })),
          ],
        },
        navigateTo: '/dashboard/admin/crm',
      };
    },
  },
};
