import type { DashboardQueueDto, QueueEntryDetailDto } from '@barbercue/shared';
import { applySnapshot, describeAutoAssign, notYetAssigned, sectionsOf } from '../queue-sections';

const entry = (id: string, status: string, assignedStaffId: string | null = null): QueueEntryDetailDto =>
  ({ id, status, assignedStaffId } as unknown as QueueEntryDetailDto);
const board = (extra: Partial<DashboardQueueDto> = {}): DashboardQueueDto => ({ entries: [], staffRoster: [], chairs: [], services: [], ...extra });

describe('queue sections', () => {
  it('uses the server sections when present (including the assigned section)', () => {
    const sections = { waiting: [entry('a', 'WAITING')], called: [], assigned: [entry('g', 'CALLED', 'st1')], inService: [], completedToday: [entry('c', 'COMPLETED')], historyToday: [entry('h', 'CANCELLED')] };
    const result = sectionsOf(board({ sections }));
    expect(result.waiting).toBe(sections.waiting);
    expect(result.assigned).toBe(sections.assigned);
    expect(result.completedToday).toBe(sections.completedToday);
  });

  it('derives the split from phases for an older server, never mixing an assigned or seated customer into waiting', () => {
    const derived = sectionsOf(
      board({ entries: [entry('w', 'WAITING'), entry('c', 'CALLED'), entry('a', 'CALLED', 'st1'), entry('s', 'IN_SERVICE', 'st2')] }),
    );
    expect(derived.waiting.map((e) => e.id)).toEqual(['w']);
    expect(derived.called.map((e) => e.id)).toEqual(['c']);
    expect(derived.assigned.map((e) => e.id)).toEqual(['a']);
    expect(derived.inService.map((e) => e.id)).toEqual(['s']);
    expect(derived.completedToday).toEqual([]);
  });

  it('a server that sends sections but no assigned list still never lists an assigned customer twice', () => {
    const sections = { waiting: [], called: [entry('a', 'CALLED', 'st1'), entry('c', 'CALLED')], inService: [], completedToday: [], historyToday: [] };
    const result = sectionsOf(board({ entries: [entry('a', 'CALLED', 'st1'), entry('c', 'CALLED')], sections }));
    expect(result.called.map((e) => e.id)).toEqual(['c']);
    expect(result.assigned.map((e) => e.id)).toEqual(['a']);
  });

  it('lists called customers ahead of waiting ones, and never includes assigned ones', () => {
    const sections = sectionsOf(board({ entries: [entry('w', 'WAITING'), entry('c', 'CALLED'), entry('a', 'CALLED', 'st1')] }));
    expect(notYetAssigned(sections).map((e) => e.id)).toEqual(['c', 'w']);
  });
});

describe('snapshot ordering', () => {
  it('never lets an older response replace a newer board', () => {
    const newer = board({ revision: 200 });
    const older = board({ revision: 100 });
    expect(applySnapshot(newer, older)).toBe(newer);
  });
  it('applies equal or newer revisions and any snapshot from a server without revisions', () => {
    const current = board({ revision: 100 });
    const equal = board({ revision: 100 });
    const newer = board({ revision: 101 });
    expect(applySnapshot(current, equal)).toBe(equal);
    expect(applySnapshot(current, newer)).toBe(newer);
    const legacy = board();
    expect(applySnapshot(current, legacy)).toBe(legacy);
    expect(applySnapshot(null, newer)).toBe(newer);
  });
});

describe('automatic assignment wording', () => {
  it('says plainly when nobody could be assigned', () => {
    expect(describeAutoAssign({ assigned: [], skipped: [] })).toBe('Nobody is waiting who can be assigned right now.');
  });
  it('reports how many were assigned (the barber starts each service) and why others are still waiting', () => {
    const text = describeAutoAssign({ assigned: [{}, {}], skipped: [{ reason: 'No free chair.' }, { reason: 'No free chair.' }] });
    expect(text).toBe('Assigned 2 customers. The barber starts each service. 2 still waiting. No free chair.');
  });
  it('uses the singular for one customer', () => {
    expect(describeAutoAssign({ assigned: [{}], skipped: [] })).toBe('Assigned 1 customer. The barber starts each service.');
  });
});
