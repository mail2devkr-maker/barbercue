import { AssistantRollout } from './assistant-rollout';

const A = { id: '11111111-1111-4111-8111-111111111111' };
const B = { id: '22222222-2222-4222-8222-222222222222' };

describe('AssistantRollout (fail closed)', () => {
  it('is off for everyone when nothing, or anything unrecognised, is set', () => {
    for (const env of [
      {},
      { ASSISTANT_MODE: '' },
      { ASSISTANT_MODE: 'ON' },
      { ASSISTANT_MODE: 'true' },
      { ASSISTANT_MODE: 'All' },
      { ASSISTANT_MODE: '1', ASSISTANT_WRITES: 'all' },
    ]) {
      const r = new AssistantRollout(env);
      expect([r.enabledFor(A), r.writesFor(A)]).toEqual([false, false]);
    }
  });

  it('cohort mode lets only listed users in; writes stay off unless switched on', () => {
    const r = new AssistantRollout({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_COHORT_USER_IDS: ` ${A.id.toUpperCase()} , not-a-uuid,`,
    });
    expect([r.enabledFor(A), r.enabledFor(B)]).toEqual([true, false]);
    expect(r.writesFor(A)).toBe(false);
    expect(r.describe()).toBe(
      'mode=cohort writes=off cohort=1 writeSalons=0 writeActions=0',
    );
  });

  it('writes never exceed who can use the assistant', () => {
    const r = new AssistantRollout({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_WRITES: 'all',
      ASSISTANT_COHORT_USER_IDS: A.id,
    });
    expect([r.writesFor(A), r.writesFor(B)]).toEqual([true, false]);
    const reads = new AssistantRollout({
      ASSISTANT_MODE: 'all',
      ASSISTANT_WRITES: 'cohort',
      ASSISTANT_COHORT_USER_IDS: A.id,
    });
    expect([
      reads.enabledFor(B),
      reads.writesFor(B),
      reads.writesFor(A),
    ]).toEqual([true, false, true]);
  });

  it('an empty cohort admits nobody', () => {
    const r = new AssistantRollout({
      ASSISTANT_MODE: 'cohort',
      ASSISTANT_WRITES: 'cohort',
    });
    expect([r.enabledFor(A), r.writesFor(A)]).toEqual([false, false]);
  });
});

describe('AssistantRollout write allowlist (#372, default deny)', () => {
  const U = { id: '11111111-1111-4111-8111-111111111111' };
  const SHOP = '22222222-2222-4222-8222-222222222222';
  const OTHER = '33333333-3333-4333-8333-333333333333';
  const base = {
    ASSISTANT_MODE: 'cohort',
    ASSISTANT_WRITES: 'cohort',
    ASSISTANT_COHORT_USER_IDS: U.id,
  };
  it('writes on but no allowlists: nothing may be edited', () => {
    const r = new AssistantRollout(base);
    expect(r.writesFor(U)).toBe(true);
    expect(r.writeAllowed(U, 'chairs.setStatus', SHOP)).toBe(false);
  });
  it('only the listed shop AND the listed action', () => {
    const r = new AssistantRollout({
      ...base,
      ASSISTANT_WRITE_SALON_IDS: SHOP,
      ASSISTANT_WRITE_ACTIONS: 'chairs.setStatus, services.setPrice',
    });
    expect(r.writeAllowed(U, 'chairs.setStatus', SHOP)).toBe(true);
    expect(r.writeAllowed(U, 'services.setPrice', SHOP)).toBe(true);
    expect(r.writeAllowed(U, 'chairs.setStatus', OTHER)).toBe(false);
    expect(r.writeAllowed(U, 'staff.setStatus', SHOP)).toBe(false);
    expect(
      r.writeAllowed(
        { id: '44444444-4444-4444-8444-444444444444' },
        'chairs.setStatus',
        SHOP,
      ),
    ).toBe(false);
  });
  it('writes off: the allowlists open nothing', () => {
    const r = new AssistantRollout({
      ...base,
      ASSISTANT_WRITES: 'off',
      ASSISTANT_WRITE_SALON_IDS: '*',
      ASSISTANT_WRITE_ACTIONS: '*',
    });
    expect(r.writeAllowed(U, 'chairs.setStatus', SHOP)).toBe(false);
  });
  it('a self-service write with no shop needs only its action', () => {
    const r = new AssistantRollout({
      ...base,
      ASSISTANT_WRITE_ACTIONS: 'me.cancelBooking',
    });
    expect(r.writeAllowed(U, 'me.cancelBooking', null)).toBe(true);
    expect(r.writeAllowed(U, 'me.leaveQueue', null)).toBe(false);
  });
  it('"*" is only honoured alone; junk entries are ignored', () => {
    expect(
      new AssistantRollout({
        ...base,
        ASSISTANT_WRITE_SALON_IDS: '*,' + SHOP,
        ASSISTANT_WRITE_ACTIONS: '*',
      }).writeAllowed(U, 'chairs.setStatus', OTHER),
    ).toBe(false);
    expect(
      new AssistantRollout({
        ...base,
        ASSISTANT_WRITE_SALON_IDS: SHOP,
        ASSISTANT_WRITE_ACTIONS: 'DROP TABLE, chairs.setStatus',
      }).writeAllowed(U, 'chairs.setStatus', SHOP),
    ).toBe(true);
  });
});
