import { QueueEntryStatus } from './enums';

/**
 * Where a queue customer is, in the words the owner approved:
 *
 *   WAITING -> ASSIGNED -> IN_SERVICE -> COMPLETED
 *
 * Persisted status stays the existing QueueEntryStatus (no new enum value, so every released client
 * and every historical row keeps its meaning). ASSIGNED is not a database status: it is a CALLED
 * entry that has a reserved barber and chair - "called to staff", service not started. A CALLED
 * entry with no barber is just called to the counter (CALLED).
 */
export type QueueEntryPhase =
  | 'WAITING'
  | 'CALLED'
  | 'ASSIGNED'
  | 'IN_SERVICE'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'EXPIRED';

export function queuePhaseOf(entry: {
  status: QueueEntryStatus | string;
  assignedStaffId?: string | null;
  phase?: QueueEntryPhase;
}): QueueEntryPhase {
  if (entry.phase) return entry.phase;
  switch (entry.status) {
    case QueueEntryStatus.WAITING:
      return 'WAITING';
    case QueueEntryStatus.CALLED:
      return entry.assignedStaffId ? 'ASSIGNED' : 'CALLED';
    case QueueEntryStatus.IN_SERVICE:
      return 'IN_SERVICE';
    case QueueEntryStatus.COMPLETED:
      return 'COMPLETED';
    case QueueEntryStatus.NO_SHOW:
      return 'NO_SHOW';
    case QueueEntryStatus.CANCELLED:
      return 'CANCELLED';
    default:
      return 'EXPIRED';
  }
}

/** True while a barber + chair are held for a customer whose service has not started. */
export function isAssignedNotStarted(entry: {
  status: QueueEntryStatus | string;
  assignedStaffId?: string | null;
  phase?: QueueEntryPhase;
}): boolean {
  return queuePhaseOf(entry) === 'ASSIGNED';
}
