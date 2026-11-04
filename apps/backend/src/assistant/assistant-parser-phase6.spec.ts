import { AssistantActionId } from '@barbercue/shared';
import { parseAssistantText } from './assistant-parser';

const employee = (t: string) => parseAssistantText(t, 'employee', 2026);
const shop = (t: string) => parseAssistantText(t, 'shop', 2026);
const customer = (t: string) => parseAssistantText(t, 'customer', 2026);

describe('assistant batch 6 intents (field employee, read-only)', () => {
  it('summary, leads with an optional status, follow-ups and visits', () => {
    expect(employee('mera kaam kitna hua')).toEqual({ action: AssistantActionId.EMPLOYEE_DASHBOARD });
    expect(employee('mera dashboard dikhao')).toEqual({ action: AssistantActionId.EMPLOYEE_DASHBOARD });
    expect(employee('mere leads dikhao')).toEqual({ action: AssistantActionId.EMPLOYEE_LEADS, status: null });
    expect(employee('interested leads dikhao')).toEqual({ action: AssistantActionId.EMPLOYEE_LEADS, status: 'INTERESTED' });
    expect(employee('naye leads')).toEqual({ action: AssistantActionId.EMPLOYEE_LEADS, status: 'NEW' });
    expect(employee('aaj ke follow up dikhao')).toEqual({ action: AssistantActionId.EMPLOYEE_FOLLOW_UPS, overdueOnly: false });
    expect(employee('overdue follow ups')).toEqual({ action: AssistantActionId.EMPLOYEE_FOLLOW_UPS, overdueOnly: true });
    expect(employee('lead ke baaki followup batao')).toEqual({ action: AssistantActionId.EMPLOYEE_FOLLOW_UPS, overdueOnly: true });
    expect(employee('meri visits dikhao')).toEqual({ action: AssistantActionId.EMPLOYEE_VISITS });
  });

  it('language still works for an employee; shop phrases do not', () => {
    expect(employee('meri language hindi karo')).toEqual({ action: AssistantActionId.LANGUAGE_SET, language: 'HI' });
    expect(employee('aaj ki queue dikhao')).toBeNull();
    expect(employee('Haircut 200 se 150 karo')).toBeNull();
  });

  it('admin reads: verification queue with a status, CRM team overview; revenue words stay with the overview', () => {
    const admin = (t: string) => parseAssistantText(t, 'admin', 2026);
    expect(admin('pending verification dikhao')).toEqual({ action: AssistantActionId.ADMIN_VERIFICATION_QUEUE, status: null });
    expect(admin('rejected verifications dikhao')).toEqual({ action: AssistantActionId.ADMIN_VERIFICATION_QUEUE, status: 'REJECTED' });
    expect(admin('sales team ka kaam dikhao')).toEqual({ action: AssistantActionId.ADMIN_CRM_OVERVIEW });
    expect(admin('CRM overview')).toEqual({ action: AssistantActionId.ADMIN_CRM_OVERVIEW });
    expect(admin('is mahine ki sales kitni hui')).toMatchObject({ action: AssistantActionId.ADMIN_OVERVIEW });
    expect(admin('kitni shops open hain')).toEqual({ action: AssistantActionId.ADMIN_SHOP_STATUS });
    // Never from shop or employee screens.
    expect(shop('pending verification dikhao')?.action).not.toBe(AssistantActionId.ADMIN_VERIFICATION_QUEUE);
    expect(employee('CRM overview')?.action).not.toBe(AssistantActionId.ADMIN_CRM_OVERVIEW);
  });

  it('employee phrases are not reachable from shop or customer screens', () => {
    for (const t of ['mere leads dikhao', 'overdue follow ups', 'meri visits dikhao']) {
      for (const r of [shop(t), customer(t)]) {
        expect(String(r?.action ?? '')).not.toMatch(/^employee\./);
      }
    }
  });
});
