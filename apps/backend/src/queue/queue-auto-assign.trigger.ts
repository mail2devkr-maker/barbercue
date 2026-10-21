import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { isFastQueMaintenanceEnabled } from '../maintenance/maintenance-mode.service';

export type QueueAutoAssignHandler = (salonId: string) => Promise<void>;

/**
 * A tiny, dependency-free seam between the queue engine and the automatic allocator.
 *
 * The allocator (owner-operations module) must run after anything that can change who may be seated
 * - a customer joins/arrives, a service completes, a barber clocks in, a chair frees up - but those
 * events live in QueueService/StaffStatusService, which must not import the allocator back (that
 * would be a circular dependency, and the allocator itself calls QueueService to do the seating).
 * The allocator registers itself here once at startup; queue code just calls `trigger(salonId)`.
 *
 * Triggers for one salon COALESCE: while a run is in flight, any number of further triggers only
 * schedule one more pass afterwards, so a burst of events can never stack concurrent allocators.
 * The call is fire-and-forget and can never fail the business action that raised it - an allocator
 * error is logged and the queue simply stays as it was (the owner can still assign by hand).
 */
@Injectable()
export class QueueAutoAssignTrigger implements OnModuleDestroy {
  private readonly logger = new Logger(QueueAutoAssignTrigger.name);
  private handler: QueueAutoAssignHandler | null = null;
  private shuttingDown = false;
  private readonly inFlight = new Map<
    string,
    { again: boolean; promise: Promise<void> | null }
  >();

  register(handler: QueueAutoAssignHandler): void {
    this.handler = handler;
  }

  trigger(salonId: string): void {
    if (this.shuttingDown || isFastQueMaintenanceEnabled()) return;
    if (!this.handler) return;
    const running = this.inFlight.get(salonId);
    if (running) {
      running.again = true;
      return;
    }
    const state = { again: false, promise: null as Promise<void> | null };
    this.inFlight.set(salonId, state);
    state.promise = this.run(salonId, state);
  }

  private async run(
    salonId: string,
    state: { again: boolean; promise: Promise<void> | null },
  ): Promise<void> {
    try {
      do {
        state.again = false;
        try {
          await this.handler?.(salonId);
        } catch (err) {
          this.logger.warn(
            `Automatic assignment pass failed for salon ${salonId}: ${err instanceof Error ? err.message : 'unknown error'}`,
          );
        }
      } while (state.again && !this.shuttingDown);
    } finally {
      this.inFlight.delete(salonId);
    }
  }

  /** Test seam: resolves once no pass is in flight for the salon. */
  async idle(salonId: string): Promise<void> {
    while (this.inFlight.has(salonId)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all(
      Array.from(this.inFlight.values())
        .map((state) => state.promise)
        .filter((promise): promise is Promise<void> => !!promise),
    );
  }
}
