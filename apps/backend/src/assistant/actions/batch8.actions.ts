import {
  AssistantActionId,
  CrmLeadStatus,
  CrmVisitOutcome,
  createCrmVisitSchema,
  updateCrmFollowUpSchema,
} from '@barbercue/shared';
import { Reply, pick, staleReply, text, type HandlerMap } from './kit';

/**
 * Batch 8 (issue #362): a field employee records their own work - a visit to one of their own leads
 * and closing one of their own open follow-ups. Both go through EmployeeService (which re-checks the
 * lead belongs to the signed-in employee), need an EMPLOYEE-audience session, and are confirmed.
 * Leads are chosen from the employee's own list only; a new shop name is never invented here.
 */

const words = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const OUTCOMES: { outcome: CrmVisitOutcome; say: string }[] = [
  { outcome: CrmVisitOutcome.CONTACTED, say: 'baat hui' },
  { outcome: CrmVisitOutcome.INTERESTED, say: 'interested' },
  { outcome: CrmVisitOutcome.DEMO_COMPLETED, say: 'demo diya' },
  { outcome: CrmVisitOutcome.FOLLOW_UP_REQUIRED, say: 'follow up chahiye' },
  { outcome: CrmVisitOutcome.NOT_INTERESTED, say: 'not interested' },
];

/** The same lead-status rule EmployeeService.createVisit applies, shown in the preview. */
function nextLeadStatus(
  current: CrmLeadStatus,
  outcome: CrmVisitOutcome,
): CrmLeadStatus | null {
  if (current === CrmLeadStatus.ONBOARDED || current === CrmLeadStatus.LOST)
    return null;
  const next =
    outcome === CrmVisitOutcome.INTERESTED ||
    outcome === CrmVisitOutcome.DEMO_COMPLETED
      ? CrmLeadStatus.INTERESTED
      : outcome === CrmVisitOutcome.FOLLOW_UP_REQUIRED
        ? CrmLeadStatus.FOLLOW_UP
        : current === CrmLeadStatus.NEW
          ? CrmLeadStatus.CONTACTED
          : null;
  return next && next !== current ? next : null;
}

export const BATCH8_HANDLERS: HandlerMap = {
  [AssistantActionId.EMPLOYEE_LOG_VISIT]: {
    async plan(c, p) {
      const leads = (await c.deps.employee.listLeads(c.user.id)).filter(
        (l) => l.status !== CrmLeadStatus.LOST,
      );
      if (!leads.length)
        throw new Reply({
          status: 'DONE',
          message:
            'You have no open leads. Add the shop as a lead first on the employee page.',
        });
      const lead = pick(
        leads,
        c.text,
        (l) => l.shopName,
        'Which of your leads did you visit?',
        (l) => `${l.shopName} visit kiya ${c.text}`,
      );
      const outcome = (p.outcome as CrmVisitOutcome | null) ?? null;
      if (!outcome) {
        return {
          status: 'NEEDS_INPUT',
          message: `How did the visit to ${lead.shopName} go?`,
          options: OUTCOMES.map((o) => ({
            label: words(o.outcome),
            text: `${lead.shopName} visit kiya, ${o.say}`,
          })),
        };
      }
      const notes = text(p.notes) || undefined;
      const input = { leadId: lead.id, outcome, ...(notes ? { notes } : {}) };
      const check = createCrmVisitSchema.safeParse(input);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That visit is not valid.'} Nothing was saved.`,
        };
      const next = nextLeadStatus(lead.status, outcome);
      return c.seal(input, { leadId: lead.id, status: lead.status }, [
        { label: 'Visit', before: null, after: `${lead.shopName} · now` },
        { label: 'Outcome', before: null, after: words(outcome) },
        ...(notes ? [{ label: 'Notes', before: null, after: notes }] : []),
        ...(next
          ? [
              {
                label: 'Lead status',
                before: words(lead.status),
                after: words(next),
              },
            ]
          : []),
      ]);
    },
    async execute(c) {
      const leadId = text(c.payload.leadId);
      const lead = (await c.deps.employee.listLeads(c.user.id)).find(
        (l) => l.id === leadId,
      );
      if (!lead) throw staleReply();
      c.assertUnchanged({ leadId, status: lead.status });
      const v = await c.deps.employee.createVisit(
        c.user.id,
        c.payload as never,
      );
      return c.done(
        `Visit to ${v.shopName} saved.`,
        'employee',
        v.id,
        [{ label: v.shopName, before: null, after: words(v.outcome) }],
        '/employee',
      );
    },
  },

  [AssistantActionId.EMPLOYEE_CLOSE_FOLLOW_UP]: {
    async plan(c, p) {
      const open = await c.deps.employee.listFollowUps(c.user.id, 'OPEN');
      if (!open.length)
        throw new Reply({
          status: 'DONE',
          message: 'You have no open follow-ups.',
        });
      const f = pick(
        [...open].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
        c.text,
        (x) => x.leadShopName,
        'Which follow-up is done?',
        (x) =>
          `${x.leadShopName} ka follow up ho gaya${p.outcome ? `: ${text(p.outcome)}` : ''}`,
      );
      const outcome = text(p.outcome) || undefined;
      const patch = {
        status: 'COMPLETED' as const,
        ...(outcome ? { outcome } : {}),
      };
      const check = updateCrmFollowUpSchema.safeParse(patch);
      if (!check.success)
        return {
          status: 'NEEDS_INPUT',
          message: `${check.error.issues[0]?.message ?? 'That change is not valid.'} Nothing was changed.`,
        };
      return c.seal(
        { followUpId: f.id, patch },
        { id: f.id, status: f.status },
        [
          {
            label: `Follow-up · ${f.leadShopName}`,
            before: 'Open',
            after: 'Done',
          },
          ...(outcome
            ? [{ label: 'Outcome', before: null, after: outcome }]
            : []),
        ],
        outcome
          ? undefined
          : 'Tip: add what happened after a colon, for example "ho gaya: demo kal".',
      );
    },
    async execute(c) {
      const id = text(c.payload.followUpId);
      const row = (await c.deps.employee.listFollowUps(c.user.id)).find(
        (x) => x.id === id,
      );
      if (!row) throw staleReply();
      c.assertUnchanged({ id, status: row.status });
      const done = await c.deps.employee.updateFollowUp(
        c.user.id,
        id,
        c.payload.patch as never,
      );
      return c.done(
        `Follow-up for ${done.leadShopName} marked done.`,
        'employee',
        done.id,
        [{ label: done.leadShopName, before: 'Open', after: 'Done' }],
        '/employee',
      );
    },
  },
};
