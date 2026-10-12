import type { DashboardQueueDto, QueueEntryDetailDto } from '@barbercue/shared';
import { applySnapshot, describeAutoAssign, notYetSeated, sectionsOf } from '../queue-sections';

const entry = (id: string, status: string): QueueEntryDetailDto => ({ id, status } as unknown as QueueEntryDetailDto);
const board = (extra: Partial<DashboardQueueDto> = {}): DashboardQueueDto => ({ entries: [], staffRoster: [], chairs: [], services: [], ...extra });

describe('queue sections', () => {
  it('uses the server sections when present', () => {
    const sections = { waiting: [entry('a', 'WAITING')], called: [], inService: [], completedToday: [entry('c', 'COMPLETED')], historyToday: [entry('h', 'CANCELLED')] };
    expect(sectionsOf(board({ sections }))).toBe(sections);
  });

  it('derives the split from statuses for an older server, never mixing a seated customer into waiting', () => {
    const derived = sectionsOf(board({ entries: [entry('w', 'WAITING'), entry('c', 'CALLED'), entry('s', 'IN_SERVICE')] }));
    expect(derived.waiting.map((e) => e.id)).toEqual(['w']);
    expect(derived.called.map((e) => e.id)).toEqual(['c']);
    expect(derived.inService.map((e) => e.id)).toEqual(['s']);
    expect(derived.completedToday).toEqual([]);
  });

  it('lists called customers ahead of waiting ones', () => {
    const sections = sectionsOf(board({ entries: [entry('w', 'WAITING'), entry('c', 'CALLED')] }));
    expect(notYetSeated(sections).map((e) => e.id)).toEqual(['c', 'w']);
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
  it('says plainly when nobody could be seated', () => {
    expect(describeAutoAssign({ assigned: [], skipped: [] })).toBe('Nobody is waiting who can be seated right now.');
  });
  it('reports how many were seated and why others are still waiting', () => {
    const text = describeAutoAssign({ assigned: [{}, {}], skipped: [{ reason: 'No free chair.' }, { reason: 'No free chair.' }] });
    expect(text).toBe('Seated 2 customers. 2 still waiting. No free chair.');
  });
  it('uses the singular for one customer', () => {
    expect(describeAutoAssign({ assigned: [{}], skipped: [] })).toBe('Seated 1 customer.');
  });
});
