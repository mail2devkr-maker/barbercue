import {
  planAllocation,
  type PlannerChair,
  type PlannerEntry,
  type PlannerStaff,
} from './queue-auto-assign.service';

const CUT = 'svc-cut';
const BEARD = 'svc-beard';

function staff(id: string, overrides: Partial<PlannerStaff> = {}): PlannerStaff {
  return {
    id,
    displayName: id.toUpperCase(),
    qualifiedServiceIds: new Set([CUT, BEARD]),
    completedToday: 0,
    lastEndedAt: null,
    ...overrides,
  };
}
function entry(id: string, overrides: Partial<PlannerEntry> = {}): PlannerEntry {
  return { id, serviceIds: [CUT], durationMinutes: 30, preferredStaffId: null, bookingId: null, ...overrides };
}
const chairs = (n: number): PlannerChair[] => Array.from({ length: n }, (_, i) => ({ id: `ch${i + 1}`, label: `Chair ${i + 1}` }));
const alwaysFree = async () => true;

describe('planAllocation', () => {
  it('seats a waiting customer with the available barber on a free chair', async () => {
    const plan = await planAllocation({ entries: [entry('e1')], staff: [staff('a')], chairs: chairs(2), isStaffFree: alwaysFree });
    expect(plan.assignments).toEqual([{ entryId: 'e1', staffId: 'a', chairId: 'ch1' }]);
    expect(plan.skipped).toEqual([]);
  });

  it('is FIFO and never gives one barber two customers in a pass', async () => {
    const plan = await planAllocation({
      entries: [entry('e1'), entry('e2'), entry('e3')],
      staff: [staff('a'), staff('b')],
      chairs: chairs(3),
      isStaffFree: alwaysFree,
    });
    expect(plan.assignments.map((x) => x.entryId)).toEqual(['e1', 'e2']);
    expect(new Set(plan.assignments.map((x) => x.staffId)).size).toBe(2);
    expect(plan.skipped.map((s) => s.entryId)).toEqual(['e3']);
  });

  it('never allocates a barber that the freedom check says is busy, reserved or off hours', async () => {
    const plan = await planAllocation({
      entries: [entry('e1')],
      staff: [staff('a'), staff('b')],
      chairs: chairs(1),
      isStaffFree: async (id) => id === 'b',
    });
    expect(plan.assignments).toEqual([{ entryId: 'e1', staffId: 'b', chairId: 'ch1' }]);
    const none = await planAllocation({ entries: [entry('e1')], staff: [staff('a')], chairs: chairs(1), isStaffFree: async () => false });
    expect(none.assignments).toEqual([]);
    expect(none.skipped[0].reason).toMatch(/busy or booked/i);
  });

  it('never allocates a barber who lacks any one of the requested services', async () => {
    const plan = await planAllocation({
      entries: [entry('e1', { serviceIds: [CUT, BEARD] })],
      staff: [staff('a', { qualifiedServiceIds: new Set([CUT]) }), staff('b')],
      chairs: chairs(1),
      isStaffFree: alwaysFree,
    });
    expect(plan.assignments[0].staffId).toBe('b');
    const nobody = await planAllocation({
      entries: [entry('e1', { serviceIds: [BEARD] })],
      staff: [staff('a', { qualifiedServiceIds: new Set([CUT]) })],
      chairs: chairs(1),
      isStaffFree: alwaysFree,
    });
    expect(nobody.assignments).toEqual([]);
    expect(nobody.skipped[0].reason).toMatch(/qualified/i);
  });

  it('honors a preferred barber exactly: waits for them instead of using someone else', async () => {
    const plan = await planAllocation({
      entries: [entry('e1', { preferredStaffId: 'a' })],
      staff: [staff('a'), staff('b')],
      chairs: chairs(2),
      isStaffFree: async (id) => id === 'b',
    });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0].reason).toContain('Waiting for A');
  });

  it('seats a preferred-barber customer when that barber is free, even with others free', async () => {
    const plan = await planAllocation({
      entries: [entry('e1', { preferredStaffId: 'b' })],
      staff: [staff('a'), staff('b')],
      chairs: chairs(2),
      isStaffFree: alwaysFree,
    });
    expect(plan.assignments[0].staffId).toBe('b');
  });

  it('a customer waiting on a busy preferred barber does not block the next customer', async () => {
    const plan = await planAllocation({
      entries: [entry('e1', { preferredStaffId: 'a' }), entry('e2')],
      staff: [staff('a'), staff('b')],
      chairs: chairs(2),
      isStaffFree: async (id) => id === 'b',
    });
    expect(plan.assignments).toEqual([{ entryId: 'e2', staffId: 'b', chairId: 'ch1' }]);
    expect(plan.skipped.map((s) => s.entryId)).toEqual(['e1']);
  });

  it('distributes work fairly: fewest services today first, then longest idle', async () => {
    const plan = await planAllocation({
      entries: [entry('e1')],
      staff: [
        staff('a', { completedToday: 5 }),
        staff('b', { completedToday: 2, lastEndedAt: new Date('2026-10-12T10:00:00Z') }),
        staff('c', { completedToday: 2, lastEndedAt: new Date('2026-10-12T09:00:00Z') }),
      ],
      chairs: chairs(1),
      isStaffFree: alwaysFree,
    });
    expect(plan.assignments[0].staffId).toBe('c');
  });

  it('keeps the customer waiting with a clear reason when no chair is free', async () => {
    const plan = await planAllocation({ entries: [entry('e1')], staff: [staff('a')], chairs: [], isStaffFree: alwaysFree });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/chairs are occupied/i);
  });

  it('does not seat a customer who has not chosen a service yet', async () => {
    const plan = await planAllocation({ entries: [entry('e1', { serviceIds: [] })], staff: [staff('a')], chairs: chairs(1), isStaffFree: alwaysFree });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/choose a service/i);
  });

  it('reports a requested barber who is not on duty at all', async () => {
    const plan = await planAllocation({
      entries: [entry('e1', { preferredStaffId: 'ghost' })],
      staff: [staff('a')],
      chairs: chairs(1),
      isStaffFree: alwaysFree,
    });
    expect(plan.assignments).toEqual([]);
    expect(plan.skipped[0].reason).toMatch(/not on duty/i);
  });
});
