import { queuePhaseOf, type DashboardQueueDto, type DashboardQueueSectionsDto, type QueueEntryDetailDto } from '@barbercue/shared';

/**
 * The Live Queue board has five separate places a visit can be, and every visit is in exactly one:
 * waiting (incl. called to the counter with no barber), ASSIGNED (a barber and chair are reserved but
 * the service has NOT started), in service, completed today, and the terminal history (cancelled,
 * expired, no-show). The server sends them pre-sorted as `sections`; for an older server that only
 * sends the flat `entries` list the same split is derived from each entry's phase, so the board never
 * mixes an assigned or seated customer into the waiting list.
 */
export function sectionsOf(data: Pick<DashboardQueueDto, 'entries' | 'sections'>): DashboardQueueSectionsDto & { assigned: QueueEntryDetailDto[] } {
  if (data.sections) {
    // `assigned` is absent from servers that predate it; derive it from the entries then, and take
    // those out of `called` so nobody is listed twice.
    if (data.sections.assigned) return { ...data.sections, assigned: data.sections.assigned };
    const assigned = data.entries.filter((e) => queuePhaseOf(e) === 'ASSIGNED');
    const assignedIds = new Set(assigned.map((e) => e.id));
    return { ...data.sections, called: data.sections.called.filter((e) => !assignedIds.has(e.id)), assigned };
  }
  const waiting: QueueEntryDetailDto[] = [];
  const called: QueueEntryDetailDto[] = [];
  const assigned: QueueEntryDetailDto[] = [];
  const inService: QueueEntryDetailDto[] = [];
  for (const entry of data.entries) {
    const phase = queuePhaseOf(entry);
    if (phase === 'WAITING') waiting.push(entry);
    else if (phase === 'CALLED') called.push(entry);
    else if (phase === 'ASSIGNED') assigned.push(entry);
    else if (phase === 'IN_SERVICE') inService.push(entry);
  }
  return { waiting, called, assigned, inService, completedToday: [], historyToday: [] };
}

/** Waiting and called customers have no barber yet; called ones lead the list. */
export function notYetAssigned(sections: DashboardQueueSectionsDto): QueueEntryDetailDto[] {
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

/**
 * One plain sentence about the outcome of an automatic assignment, including why anyone was left
 * waiting. Assigning never starts a service, so the sentence says the barber starts it.
 */
export function describeAutoAssign(result: { assigned: unknown[]; skipped: { reason: string }[] }): string {
  const assigned = result.assigned.length;
  const left = result.skipped.length;
  if (assigned === 0 && left === 0) return 'Nobody is waiting who can be assigned right now.';
  const head = assigned === 0 ? 'Nobody could be assigned yet.' : `Assigned ${assigned} customer${assigned === 1 ? '' : 's'}. The barber starts each service.`;
  if (left === 0) return head;
  const reasons = [...new Set(result.skipped.map((s) => s.reason))].slice(0, 2).join(' ');
  return `${head} ${left} still waiting. ${reasons}`.trim();
}
