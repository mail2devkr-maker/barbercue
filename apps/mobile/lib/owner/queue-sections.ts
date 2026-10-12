import type { DashboardQueueDto, DashboardQueueSectionsDto, QueueEntryDetailDto } from '@barbercue/shared';

/**
 * The Live Queue board has four separate places a visit can be, and every visit is in exactly one:
 * waiting (incl. called), in service, completed today, and the terminal history (cancelled, expired,
 * no-show). The server sends them pre-sorted as `sections`; for an older server that only sends the
 * flat `entries` list the same split is derived from each entry's status, so the board never mixes
 * a seated customer into the waiting list.
 */
export function sectionsOf(data: Pick<DashboardQueueDto, 'entries' | 'sections'>): DashboardQueueSectionsDto {
  if (data.sections) return data.sections;
  const waiting: QueueEntryDetailDto[] = [];
  const called: QueueEntryDetailDto[] = [];
  const inService: QueueEntryDetailDto[] = [];
  for (const entry of data.entries) {
    if (entry.status === 'WAITING') waiting.push(entry);
    else if (entry.status === 'CALLED') called.push(entry);
    else if (entry.status === 'IN_SERVICE') inService.push(entry);
  }
  return { waiting, called, inService, completedToday: [], historyToday: [] };
}

/** Waiting and called customers are both "not yet seated"; called ones lead the list. */
export function notYetSeated(sections: DashboardQueueSectionsDto): QueueEntryDetailDto[] {
  return [...sections.called, ...sections.waiting];
}

/**
 * Applies a freshly fetched snapshot unless it is OLDER than the one already shown - a slow response
 * that arrives after a newer one must never roll the board back. Snapshots without a revision (an
 * older server) are always applied.
 */
export function applySnapshot(current: DashboardQueueDto | null, next: DashboardQueueDto): DashboardQueueDto {
  if (current?.revision !== undefined && next.revision !== undefined && next.revision < current.revision) return current;
  return next;
}

/** One plain sentence about the outcome of an automatic assignment, including why anyone was left waiting. */
export function describeAutoAssign(result: { assigned: unknown[]; skipped: { reason: string }[] }): string {
  const seated = result.assigned.length;
  const left = result.skipped.length;
  if (seated === 0 && left === 0) return 'Nobody is waiting who can be seated right now.';
  const head = seated === 0 ? 'Nobody could be seated yet.' : `Seated ${seated} customer${seated === 1 ? '' : 's'}.`;
  if (left === 0) return head;
  const reasons = [...new Set(result.skipped.map((s) => s.reason))].slice(0, 2).join(' ');
  return `${head} ${left} still waiting. ${reasons}`.trim();
}
