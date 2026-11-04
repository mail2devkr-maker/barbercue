import {
  AssistantActionId,
  CrmLeadStatus,
  VerificationStatus,
} from '@barbercue/shared';

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
  | { action: typeof AssistantActionId.EMPLOYEE_VISITS };

export type AdminReadIntent =
  | {
      action: typeof AssistantActionId.ADMIN_VERIFICATION_QUEUE;
      status: VerificationStatus | null;
    }
  | { action: typeof AssistantActionId.ADMIN_CRM_OVERVIEW };

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

export function parsePhase6(text: string): Phase6Intent | null {
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
  if (VERIFICATION.test(text)) {
    const status =
      VERIFICATION_STATUS.find(([re]) => re.test(text))?.[1] ?? null;
    return { action: AssistantActionId.ADMIN_VERIFICATION_QUEUE, status };
  }
  if (CRM.test(text)) return { action: AssistantActionId.ADMIN_CRM_OVERVIEW };
  return null;
}
