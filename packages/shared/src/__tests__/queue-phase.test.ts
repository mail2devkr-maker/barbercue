import { QueueEntryStatus } from '../enums';
import { isAssignedNotStarted, queuePhaseOf } from '../queue-phase';

// Owner-approved workflow: WAITING -> ASSIGNED -> IN_SERVICE -> COMPLETED. "Assigned" is a CALLED
// entry that holds a barber (no new persisted status), so older records stay interpretable.
describe('queuePhaseOf', () => {
  it('a WAITING entry is waiting', () => {
    expect(queuePhaseOf({ status: QueueEntryStatus.WAITING })).toBe('WAITING');
  });

  it('a CALLED entry without a barber is just called to the counter', () => {
    expect(queuePhaseOf({ status: QueueEntryStatus.CALLED, assignedStaffId: null })).toBe('CALLED');
    expect(queuePhaseOf({ status: QueueEntryStatus.CALLED })).toBe('CALLED');
  });

  it('a CALLED entry with a barber is ASSIGNED - not waiting and not in service', () => {
    const entry = { status: QueueEntryStatus.CALLED, assignedStaffId: 'st1' };
    expect(queuePhaseOf(entry)).toBe('ASSIGNED');
    expect(isAssignedNotStarted(entry)).toBe(true);
  });

  it('only IN_SERVICE means the service has started', () => {
    expect(queuePhaseOf({ status: QueueEntryStatus.IN_SERVICE, assignedStaffId: 'st1' })).toBe('IN_SERVICE');
    expect(isAssignedNotStarted({ status: QueueEntryStatus.IN_SERVICE, assignedStaffId: 'st1' })).toBe(false);
  });

  it('keeps the terminal statuses distinct', () => {
    expect(queuePhaseOf({ status: QueueEntryStatus.COMPLETED, assignedStaffId: 'st1' })).toBe('COMPLETED');
    expect(queuePhaseOf({ status: QueueEntryStatus.NO_SHOW })).toBe('NO_SHOW');
    expect(queuePhaseOf({ status: QueueEntryStatus.CANCELLED })).toBe('CANCELLED');
    expect(queuePhaseOf({ status: QueueEntryStatus.EXPIRED })).toBe('EXPIRED');
  });

  it('prefers the server-provided phase when present', () => {
    expect(queuePhaseOf({ status: QueueEntryStatus.CALLED, assignedStaffId: null, phase: 'ASSIGNED' })).toBe('ASSIGNED');
  });
});
