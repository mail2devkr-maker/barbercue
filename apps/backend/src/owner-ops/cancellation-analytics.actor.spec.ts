import { CANCELLATION_ACTOR_VALUES } from '@barbercue/shared';
import {
  emptyActorCounts,
  resolveCancellationActor,
} from './cancellation-analytics.service';

/**
 * Owner issue #44 - owner-cancelled and customer-cancelled bookings must be told apart from TRUSTED
 * fields only. A legacy booking whose actor cannot be proven stays UNKNOWN; nothing is guessed.
 */
describe('resolveCancellationActor (#44)', () => {
  it('uses the actor recorded in the cancelling transaction as-is', () => {
    for (const actor of ['OWNER', 'CUSTOMER', 'STAFF', 'SYSTEM', 'ADMIN']) {
      expect(
        resolveCancellationActor({
          cancelledByActor: actor,
          cancelledById: 'someone',
          customerId: 'cust',
        }),
      ).toBe(actor);
    }
  });

  it('a recorded actor wins even when cancelledById equals the customer id', () => {
    expect(
      resolveCancellationActor({
        cancelledByActor: 'OWNER',
        cancelledById: 'cust',
        customerId: 'cust',
      }),
    ).toBe('OWNER');
  });

  it('legacy row: cancelledById equal to the customer proves a customer cancellation', () => {
    expect(
      resolveCancellationActor({
        cancelledByActor: null,
        cancelledById: 'cust',
        customerId: 'cust',
      }),
    ).toBe('CUSTOMER');
  });

  it('legacy row: cancelledById of another user is NOT assumed to be the owner - it stays UNKNOWN', () => {
    expect(
      resolveCancellationActor({
        cancelledByActor: null,
        cancelledById: 'some-other-user',
        customerId: 'cust',
      }),
    ).toBe('UNKNOWN');
  });

  it('legacy row with no cancelling id, or a guest booking, is UNKNOWN (never a fictional actor)', () => {
    expect(
      resolveCancellationActor({ cancelledByActor: null, cancelledById: null, customerId: 'cust' }),
    ).toBe('UNKNOWN');
    expect(
      resolveCancellationActor({ cancelledByActor: null, cancelledById: 'x', customerId: null }),
    ).toBe('UNKNOWN');
    expect(
      resolveCancellationActor({ cancelledByActor: null, cancelledById: null, customerId: null }),
    ).toBe('UNKNOWN');
  });

  it('an empty-string actor is treated as missing, not as a real actor', () => {
    expect(
      resolveCancellationActor({ cancelledByActor: '', cancelledById: null, customerId: null }),
    ).toBe('UNKNOWN');
  });
});

describe('emptyActorCounts (#44)', () => {
  it('always returns every actor key zero-filled, including UNKNOWN, so clients never see a missing key', () => {
    const counts = emptyActorCounts();
    expect(Object.keys(counts).sort()).toEqual([...CANCELLATION_ACTOR_VALUES].sort());
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(CANCELLATION_ACTOR_VALUES).toEqual(
      expect.arrayContaining(['OWNER', 'CUSTOMER', 'STAFF', 'SYSTEM', 'ADMIN', 'UNKNOWN']),
    );
  });

  it('returns a fresh object each call (no shared mutable state between requests)', () => {
    const a = emptyActorCounts();
    a.OWNER = 5;
    expect(emptyActorCounts().OWNER).toBe(0);
  });
});
