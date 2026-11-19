import {
  CRM_KPI_DEFINITIONS,
  CRM_LEAD_STATUS_META,
  CRM_LEAD_STATUSES,
  CRM_MANUAL_LEAD_STATUSES,
  CRM_WORKFLOW_LEAD_STATUSES,
  SALES_COACH_CRITERIA,
  crmCallLogSchema,
  crmLeadInputSchema,
  crmRange,
  leadStatusAfterCall,
  salesRecordingMetaSchema,
} from '../crm';

describe('CRM lead statuses', () => {
  it('labels every status once and keeps manual and workflow statuses apart', () => {
    expect(CRM_LEAD_STATUSES).toHaveLength(Object.keys(CRM_LEAD_STATUS_META).length);
    for (const s of CRM_WORKFLOW_LEAD_STATUSES) expect(CRM_MANUAL_LEAD_STATUSES).not.toContain(s);
    expect(CRM_LEAD_STATUS_META.ONBOARDED.label).toBe('Activated');
    expect(CRM_LEAD_STATUS_META.DEMO_SCHEDULED.label).toBe('Meeting scheduled');
  });
});

describe('leadStatusAfterCall', () => {
  it('moves early leads forward from the call outcome', () => {
    expect(leadStatusAfterCall('NEW', 'NO_ANSWER')).toBe('NO_ANSWER');
    expect(leadStatusAfterCall('CALL_PENDING', 'CONNECTED')).toBe('CONTACTED');
    expect(leadStatusAfterCall('CONTACTED', 'INTERESTED')).toBe('INTERESTED');
    expect(leadStatusAfterCall('INTERESTED', 'MEETING_SCHEDULED')).toBe('DEMO_SCHEDULED');
    expect(leadStatusAfterCall('NEW', 'NOT_INTERESTED')).toBe('LOST');
    expect(leadStatusAfterCall('NEW', 'INVALID_NUMBER')).toBe('INVALID_CONTACT');
  });

  it('never moves a lead backwards or out of the onboarding workflow', () => {
    expect(leadStatusAfterCall('INTERESTED', 'NO_ANSWER')).toBeNull();
    expect(leadStatusAfterCall('INTERESTED', 'CONNECTED')).toBeNull();
    for (const s of CRM_WORKFLOW_LEAD_STATUSES) expect(leadStatusAfterCall(s, 'NOT_INTERESTED')).toBeNull();
    expect(leadStatusAfterCall('DUPLICATE', 'INTERESTED')).toBeNull();
  });
});

describe('crmRange (IST calendar days)', () => {
  // 2026-11-18 20:00 UTC is 2026-11-19 01:30 IST.
  const now = new Date('2026-11-18T20:00:00Z');
  it('uses the IST date for today', () => {
    const r = crmRange({ preset: 'today' }, now);
    expect(r.from).toBe('2026-11-19');
    expect(r.start.toISOString()).toBe('2026-11-18T18:30:00.000Z');
    expect(r.end.toISOString()).toBe('2026-11-19T18:30:00.000Z');
  });
  it('covers whole days for presets and swaps reversed custom ranges', () => {
    expect(crmRange({ preset: '7d' }, now).from).toBe('2026-11-13');
    expect(crmRange({ preset: 'month' }, now).from).toBe('2026-11-01');
    const c = crmRange({ preset: 'custom', from: '2026-11-10', to: '2026-11-01' }, now);
    expect([c.from, c.to]).toEqual(['2026-11-01', '2026-11-10']);
  });
});

describe('schemas', () => {
  it('validates a lead and rejects bad phone / PIN', () => {
    expect(crmLeadInputSchema.safeParse({ shopName: 'Glow Studio', phone: '+91 98765 43210', postalCode: '226010' }).success).toBe(true);
    expect(crmLeadInputSchema.safeParse({ shopName: 'X', phone: 'abc' }).success).toBe(false);
    expect(crmLeadInputSchema.safeParse({ shopName: 'X', postalCode: '1234' }).success).toBe(false);
    expect(crmLeadInputSchema.safeParse({ shopName: 'X', unknownField: 1 }).success).toBe(false);
  });

  it('refuses a recording without explicit consent', () => {
    const base = {
      leadId: '7d2d9d7e-7c5e-4d7a-9a59-0e1f2a3b4c5d',
      durationSeconds: '120',
      consentMethod: 'VERBAL_ON_RECORDING',
      consentAt: '2026-11-18T10:00:00+05:30',
      submissionKey: 'rec-abcdef123456',
    };
    expect(salesRecordingMetaSchema.safeParse({ ...base, consentGiven: 'true' }).success).toBe(true);
    expect(salesRecordingMetaSchema.safeParse({ ...base, consentGiven: 'false' }).success).toBe(false);
    expect(salesRecordingMetaSchema.safeParse(base).success).toBe(false);
  });

  it('requires an outcome when logging a call', () => {
    expect(crmCallLogSchema.safeParse({}).success).toBe(false);
    expect(crmCallLogSchema.safeParse({ outcome: 'CONNECTED', durationSeconds: 90 }).success).toBe(true);
  });
});

describe('definitions', () => {
  it('documents every KPI and the 13 coaching criteria', () => {
    for (const v of Object.values(CRM_KPI_DEFINITIONS)) expect(v.length).toBeGreaterThan(10);
    expect(SALES_COACH_CRITERIA).toHaveLength(13);
  });
});
