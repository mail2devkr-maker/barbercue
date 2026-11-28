import { onboardingIssueMessages, onboardingDraftSchema } from '../onboarding';
import { crmAnnouncementSchema } from '../crm';
import { salonIntakeSchema } from '../schemas';

describe('onboardingIssueMessages', () => {
  it('names the exact field for real schema failures', () => {
    const r = onboardingDraftSchema.safeParse({ branchCount: 0, postalCode: '12', ownerPhone: '55', chairCount: 1.5 });
    expect(r.success).toBe(false);
    const issues = r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    const out = onboardingIssueMessages({ issues });
    expect(out).toContain('Number of branches: must be 1 or more');
    expect(out).toContain('PIN code: PIN code must be 6 digits');
    expect(out).toContain("Owner's mobile number: Enter a valid 10-digit Indian mobile number");
    expect(out).toContain('Total chairs: must be a whole number');
  });
  it('numbers service rows and ignores unrelated errors', () => {
    expect(onboardingIssueMessages({ issues: [{ path: 'services.1.basePrice', message: 'Number must be greater than or equal to 0' }] })).toEqual([
      'Service 2 - Price: must be 0 or more',
    ]);
    expect(onboardingIssueMessages(undefined)).toEqual([]);
    expect(onboardingIssueMessages({ missing: [] })).toEqual([]);
  });
});

describe('new schemas', () => {
  it('needs something to change for intake, and https links for CEO videos', () => {
    expect(salonIntakeSchema.safeParse({}).success).toBe(false);
    expect(salonIntakeSchema.safeParse({ queuePaused: true }).success).toBe(true);
    expect(crmAnnouncementSchema.safeParse({ title: 'Hi', videoUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(crmAnnouncementSchema.safeParse({ title: 'Hi', videoUrl: '' }).success).toBe(true);
  });
});
