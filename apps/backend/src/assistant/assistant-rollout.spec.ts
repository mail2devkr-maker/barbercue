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
    expect(r.describe()).toBe('mode=cohort writes=off cohort=1');
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
