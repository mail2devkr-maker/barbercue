import { computeFirstIncompleteStep, ONBOARDING_SKIPPABLE_STEPS, ONBOARDING_TOTAL_STEPS } from '../onboarding-progress';

const ALL_DONE = { hasService: true, hasOpenDay: true, hasPhoto: true, hasChair: true, hasStaff: true, hasPaymentQr: true };

describe('computeFirstIncompleteStep', () => {
  it('returns step 1 (Services) when nothing is set up yet', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasService: false })).toBe(1);
  });

  it('returns step 2 (Hours) once a service exists but no open day is set', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasOpenDay: false })).toBe(2);
  });

  it('returns step 3 (Photos) once service+hours exist but no photo is uploaded', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasPhoto: false })).toBe(3);
  });

  it('returns step 4 (Chairs) once service+hours+photos exist but no chair is added', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasChair: false })).toBe(4);
  });

  it('returns step 5 (Staff) once everything before it exists but no barber is added', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasStaff: false })).toBe(5);
  });

  it('returns step 6 (Payment QR) once everything before it exists but no QR is configured', () => {
    expect(computeFirstIncompleteStep({ ...ALL_DONE, hasPaymentQr: false })).toBe(6);
  });

  it('returns step 7 (Go Live) once every step has something saved', () => {
    expect(computeFirstIncompleteStep(ALL_DONE)).toBe(ONBOARDING_TOTAL_STEPS);
  });

  it('resumes at the earliest incomplete step even when later steps are also incomplete', () => {
    expect(computeFirstIncompleteStep({ hasService: true, hasOpenDay: false, hasPhoto: false, hasChair: false, hasStaff: false, hasPaymentQr: false })).toBe(2);
  });
});

describe('ONBOARDING_SKIPPABLE_STEPS', () => {
  it('marks only the advisory steps (Hours, Photos, Payment QR) as skippable', () => {
    expect(ONBOARDING_SKIPPABLE_STEPS.has(2)).toBe(true);
    expect(ONBOARDING_SKIPPABLE_STEPS.has(3)).toBe(true);
    expect(ONBOARDING_SKIPPABLE_STEPS.has(6)).toBe(true);
  });

  it('never marks a required activation step (Services, Chairs, Staff) as skippable', () => {
    expect(ONBOARDING_SKIPPABLE_STEPS.has(1)).toBe(false);
    expect(ONBOARDING_SKIPPABLE_STEPS.has(4)).toBe(false);
    expect(ONBOARDING_SKIPPABLE_STEPS.has(5)).toBe(false);
  });
});
