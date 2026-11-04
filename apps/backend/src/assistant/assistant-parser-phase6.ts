import {
  AssistantActionId,
  CrmLeadStatus,
  CrmVisitOutcome,
  VerificationStatus,
} from '@barbercue/shared';
import { daySpecIn, timesIn, type DaySpec } from './assistant-when';

/**
 * Batch 6 intents (issue #362): a field employee's own CRM, read-only. Leads, follow-ups, visits
 * and the summary come from the employee's own records only (EmployeeService scopes every query to
 * the signed-in employee). Creating or changing leads stays in the employee screens for now.
 */
export type Phase6Intent =
  | { action: typeof AssistantActionId.EMPLOYEE_DASHBOARD }
  | {
      action: typeof AssistantActionId.EMPLOYEE_LEADS;
      status: CrmLeadStatus | null;
    }
  | {
      action: typeof AssistantActionId.EMPLOYEE_FOLLOW_UPS;
      overdueOnly: boolean;
    }
  | { action: typeof AssistantActionId.EMPLOYEE_VISITS }
  | {
      action: typeof AssistantActionId.EMPLOYEE_LOG_VISIT;
      outcome: CrmVisitOutcome | null;
      notes: string | null;
    }
  | {
      action: typeof AssistantActionId.EMPLOYEE_CLOSE_FOLLOW_UP;
      outcome: string | null;
    }
  | {
      action: typeof AssistantActionId.EMPLOYEE_SCHEDULE_FOLLOW_UP;
      day: DaySpec | null;
      time: string | null;
      channel: 'CALL' | 'WHATSAPP' | 'VISIT' | 'EMAIL';
      notes: string | null;
    };

export type AdminReadIntent =
  | {
      action: typeof AssistantActionId.ADMIN_VERIFICATION_QUEUE;
      status: VerificationStatus | null;
    }
  | { action: typeof AssistantActionId.ADMIN_CRM_OVERVIEW }
  | { action: typeof AssistantActionId.ADMIN_SHOP_ACTIVITY; days: number };

const W = (words: string) => new RegExp(`(?:^|\\s)(?:${words})(?=\\s|$)`, 'u');

const FOLLOW_UP = W('follow up|follow ups|followup|followups|फॉलो अप|फॉलोअप');
const VISIT = W('visit|visits|daura|dauray|विज़िट|विजिट|दौरा');
const LEAD = W('lead|leads|prospect|prospects|लीड');
const SUMMARY = W(
  'dashboard|summary|performance|progress|report|conversion|mera kaam|kitna kaam|डैशबोर्ड|रिपोर्ट',
);
const OVERDUE = W('overdue|late|baaki|pending|chhoot|छूटे|बाकी');

const LEAD_STATUS: [RegExp, CrmLeadStatus][] = [
  [W('new|naya|naye|नए|नया'), CrmLeadStatus.NEW],
  [W('contacted|baat hui|sampark'), CrmLeadStatus.CONTACTED],
  [W('interested|ichchhuk|dilchaspi'), CrmLeadStatus.INTERESTED],
  [W('demo'), CrmLeadStatus.DEMO_SCHEDULED],
  [W('onboarded|joined|jud gaye|जुड़'), CrmLeadStatus.ONBOARDED],
  [W('lost|gaya|chhod|खोए'), CrmLeadStatus.LOST],
];

const LOG = W(
  'log|log karo|darj|record|save|kiya|ki|ho gaya|ho gayi|gaya tha|gayi thi|mila|mili|लॉग|दर्ज',
);
const DONE = W(
  'done|ho gaya|ho gayi|complete|completed|poora|pura|khatam|close|band karo|पूरा|हो गया',
);
const VISIT_OUTCOME: [RegExp, CrmVisitOutcome][] = [
  [
    W('not interested|interested nahi|mana|mana kar diya|nahi chahiye|मना'),
    CrmVisitOutcome.NOT_INTERESTED,
  ],
  [W('demo'), CrmVisitOutcome.DEMO_COMPLETED],
  [
    W('follow up chahiye|dobara|phir se|fir se|दोबारा'),
    CrmVisitOutcome.FOLLOW_UP_REQUIRED,
  ],
  [W('interested|dilchaspi|ichchhuk|रुचि'), CrmVisitOutcome.INTERESTED],
  [W('baat hui|contacted|mil liya|मिल'), CrmVisitOutcome.CONTACTED],
];

function afterColon(raw: string): string | null {
  const i = raw.indexOf(':');
  const v = i >= 0 ? raw.slice(i + 1).trim() : '';
  return v || null;
}

const SCHEDULE = W(
  'lagao|laga do|rakho|rakh do|set karo|schedule|banao|bana do|karna hai|yaad dilana|लगाओ|रखो',
);
function channelIn(text: string): 'CALL' | 'WHATSAPP' | 'VISIT' | 'EMAIL' {
  if (W('whatsapp|व्हाट्सएप').test(text)) return 'WHATSAPP';
  if (W('email|mail|ईमेल').test(text)) return 'EMAIL';
  if (W('visit|milne|milna|jaana|jana|विज़िट').test(text)) return 'VISIT';
  return 'CALL';
}

export function parsePhase6(
  text: string,
  raw = text,
  year = new Date().getUTCFullYear(),
): Phase6Intent | null {
  // "Sharma Salon ka follow up kal 4 baje lagao" - scheduled on one of my own leads.
  if (FOLLOW_UP.test(text) && SCHEDULE.test(text) && !DONE.test(text)) {
    const [time] = timesIn(text);
    return {
      action: AssistantActionId.EMPLOYEE_SCHEDULE_FOLLOW_UP,
      day: daySpecIn(text, year),
      time: time ?? null,
      channel: channelIn(text),
      notes: afterColon(raw),
    };
  }
  // Writes first: "X ka follow up ho gaya: ...", "X visit kiya, interested".
  if (
    FOLLOW_UP.test(text) &&
    DONE.test(text) &&
    !VISIT.test(text) &&
    !W('dikhao|batao|list|kitne').test(text)
  ) {
    return {
      action: AssistantActionId.EMPLOYEE_CLOSE_FOLLOW_UP,
      outcome: afterColon(raw),
    };
  }
  if (
    VISIT.test(text) &&
    LOG.test(text) &&
    !W('dikhao|batao|list|kitni|meri visits|mere visits').test(text)
  ) {
    const outcome = VISIT_OUTCOME.find(([re]) => re.test(text))?.[1] ?? null;
    return {
      action: AssistantActionId.EMPLOYEE_LOG_VISIT,
      outcome,
      notes: afterColon(raw),
    };
  }
  if (FOLLOW_UP.test(text))
    return {
      action: AssistantActionId.EMPLOYEE_FOLLOW_UPS,
      overdueOnly: OVERDUE.test(text),
    };
  if (VISIT.test(text)) return { action: AssistantActionId.EMPLOYEE_VISITS };
  if (LEAD.test(text)) {
    const status = LEAD_STATUS.find(([re]) => re.test(text))?.[1] ?? null;
    return { action: AssistantActionId.EMPLOYEE_LEADS, status };
  }
  if (SUMMARY.test(text))
    return { action: AssistantActionId.EMPLOYEE_DASHBOARD };
  return null;
}

const VERIFICATION = W(
  'verification|verify|verifications|kyc|सत्यापन|वेरिफिकेशन',
);
const CRM = W(
  // Bare "sales" is revenue (admin overview); only team words mean the field-sales CRM.
  'crm|sales team|field team|field employees|employees|leads|onboarding team|सेल्स टीम',
);
const VERIFICATION_STATUS: [RegExp, VerificationStatus][] = [
  [W('under review|review mein|reviewing'), VerificationStatus.UNDER_REVIEW],
  [W('approved|manjoor|मंजूर'), VerificationStatus.APPROVED],
  [W('rejected|reject|namanjoor|नामंजूर'), VerificationStatus.REJECTED],
];

/** Platform reads on the admin screens (batch 7). Decisions are never parsed here. */
export function parseAdminReads(text: string): AdminReadIntent | null {
  if (W('activity|busy|busiest|sabse busy|chal rahi').test(text)) {
    const week = W('hafte|hafta|week|7 din|saat din|हफ्ते').test(text);
    return {
      action: AssistantActionId.ADMIN_SHOP_ACTIVITY,
      days: week ? 7 : 1,
    };
  }
  if (VERIFICATION.test(text)) {
    const status =
      VERIFICATION_STATUS.find(([re]) => re.test(text))?.[1] ?? null;
    return { action: AssistantActionId.ADMIN_VERIFICATION_QUEUE, status };
  }
  if (CRM.test(text)) return { action: AssistantActionId.ADMIN_CRM_OVERVIEW };
  return null;
}
