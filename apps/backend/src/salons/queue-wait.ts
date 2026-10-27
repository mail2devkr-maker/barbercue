import {
  computeSlotCapacity,
  estimateWaitMinutes,
  estimateWaitRangeMinutes,
  remainingSessionMinutes,
} from '@barbercue/shared';

// Live-queue wait for search results — the same formula as QueueService.getQueueStatus (the queue
// page's own estimate): people WAITING, served in batches of the salon's capacity (ACTIVE staff vs
// free ACTIVE chairs), each batch taking the average service duration, plus the average time left
// on services already in the chair. Search computes it for a whole page of salons at once.

/** Same fallback the queue service uses when a salon has no service durations. */
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;

export interface QueueWaitInputs {
  waitingCount: number;
  activeStaff: number;
  activeChairs: number;
  occupiedChairs: number;
  avgServiceMinutes: number | null;
  /** Services currently in the chair: nominal duration and minutes elapsed. */
  activeSessions: { durationMinutes: number; elapsedMinutes: number }[];
}

export interface QueueWait {
  waitingCount: number;
  estimatedWaitMinutes: number;
  range: { min: number; max: number };
}

/** Null when the salon has no free capacity to estimate against (no active staff or chairs). */
export function estimateQueueWait(inputs: QueueWaitInputs): QueueWait | null {
  const servers = computeSlotCapacity(
    inputs.activeStaff,
    Math.max(0, inputs.activeChairs - inputs.occupiedChairs),
  );
  const remaining = inputs.activeSessions.length
    ? inputs.activeSessions.reduce(
        (sum, s) =>
          sum + remainingSessionMinutes(s.durationMinutes, s.elapsedMinutes),
        0,
      ) / inputs.activeSessions.length
    : 0;
  const minutes = estimateWaitMinutes(
    servers,
    inputs.waitingCount,
    inputs.avgServiceMinutes ?? DEFAULT_SERVICE_DURATION_MINUTES,
    remaining,
  );
  if (minutes === null) return null;
  return {
    waitingCount: inputs.waitingCount,
    estimatedWaitMinutes: minutes,
    range: estimateWaitRangeMinutes(minutes)!,
  };
}
