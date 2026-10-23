import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

export type DbDeadlineDomain = 'booking' | 'queue';

export interface DbDeadlineJob {
  name: string;
  domain: DbDeadlineDomain;
  nextDueAt: () => Promise<Date | null>;
  runDue: () => Promise<void>;
}

interface JobState {
  job: DbDeadlineJob;
  timer: NodeJS.Timeout | null;
  refreshTimer: NodeJS.Timeout | null;
  running: boolean;
  refreshing: boolean;
  pendingRefresh: boolean;
}

const MIN_DELAY_MS = 250;
const MAX_TIMER_DELAY_MS = 2_000_000_000;
const DEFAULT_RECONCILE_INTERVAL_MS = 60 * 60 * 1000;
const MIN_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Every reconcile tick is one database lookup per job, and on Neon a lookup against a suspended
 * compute wakes it for at least the ~5 minute autosuspend window. `DB_DEADLINE_RECONCILE_MS` lets
 * operations stretch the coarse safety-net tick (e.g. 21600000 = 6 h) to save compute hours. The
 * default stays one hour, so behaviour is unchanged until the variable is set. A value that is not an
 * integer or is below the 5 minute floor falls back to the default (never to something *more*
 * frequent); a value above 24 h is capped at 24 h.
 */
export function resolveReconcileIntervalMs(raw: string | undefined): number {
  const text = raw?.trim();
  if (!text) return DEFAULT_RECONCILE_INTERVAL_MS;
  const value = Number(text);
  if (!Number.isInteger(value) || value < MIN_RECONCILE_INTERVAL_MS) {
    return DEFAULT_RECONCILE_INTERVAL_MS;
  }
  return Math.min(value, MAX_RECONCILE_INTERVAL_MS);
}

/**
 * Keeps deadline-driven database jobs accurate without waking Neon every minute.
 *
 * Each registered job does one lookup to discover its next real deadline, sleeps in-process until
 * that instant, then runs and discovers the following deadline. Domain signals from ordinary
 * booking/queue mutations trigger a cheap re-plan while the database is already awake. A coarse
 * hourly reconciliation is the crash/manual-write safety net; it is intentionally nowhere near the
 * old minute-level cadence, so an otherwise idle Neon compute can scale to zero between checks.
 */
@Injectable()
export class DbDeadlineSchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(DbDeadlineSchedulerService.name);
  private readonly jobs = new Map<string, JobState>();
  private reconcileTimer: NodeJS.Timeout | null = null;

  register(job: DbDeadlineJob): () => void {
    this.unregister(job.name);
    const state: JobState = {
      job,
      timer: null,
      refreshTimer: null,
      running: false,
      refreshing: false,
      pendingRefresh: false,
    };
    this.jobs.set(job.name, state);
    this.logger.log(
      `Registered adaptive DB deadline job: ${job.name} (${job.domain})`,
    );
    this.ensureReconcileTimer();
    this.queueRefresh(state, 0);
    return () => this.unregister(job.name);
  }

  signal(domain: DbDeadlineDomain): void {
    for (const state of this.jobs.values()) {
      if (state.job.domain === domain) this.queueRefresh(state, 50);
    }
  }

  private ensureReconcileTimer(): void {
    if (this.reconcileTimer) return;
    const configured = process.env.DB_DEADLINE_RECONCILE_MS;
    const intervalMs = resolveReconcileIntervalMs(configured);
    if (
      configured?.trim() &&
      intervalMs === DEFAULT_RECONCILE_INTERVAL_MS &&
      Number(configured) !== intervalMs
    ) {
      this.logger.warn(
        `Ignoring DB_DEADLINE_RECONCILE_MS (expected an integer >= ${MIN_RECONCILE_INTERVAL_MS}); using the default ${DEFAULT_RECONCILE_INTERVAL_MS} ms`,
      );
    }
    this.logger.log(`Deadline reconcile interval: ${intervalMs} ms`);
    this.reconcileTimer = setInterval(() => {
      for (const state of this.jobs.values()) this.queueRefresh(state, 0);
    }, intervalMs);
    this.reconcileTimer.unref?.();
  }

  private queueRefresh(state: JobState, delayMs: number): void {
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => {
      state.refreshTimer = null;
      void this.refresh(state);
    }, delayMs);
    state.refreshTimer.unref?.();
  }

  private async refresh(state: JobState): Promise<void> {
    if (state.running || state.refreshing) {
      state.pendingRefresh = true;
      return;
    }

    state.refreshing = true;
    state.pendingRefresh = false;
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    try {
      const dueAt = await state.job.nextDueAt();
      if (!dueAt) return;

      const delay = Math.max(
        MIN_DELAY_MS,
        Math.min(MAX_TIMER_DELAY_MS, dueAt.getTime() - Date.now()),
      );
      state.timer = setTimeout(() => {
        state.timer = null;
        void this.run(state);
      }, delay);
      state.timer.unref?.();
    } catch (error) {
      this.logger.error(
        `Could not plan deadline job ${state.job.name}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      // Retry planning later without falling back to minute-level polling.
      state.timer = setTimeout(
        () => {
          state.timer = null;
          this.queueRefresh(state, 0);
        },
        5 * 60 * 1000,
      );
      state.timer.unref?.();
    } finally {
      state.refreshing = false;
      if (state.pendingRefresh) this.queueRefresh(state, 0);
    }
  }

  private async run(state: JobState): Promise<void> {
    if (state.running) return;
    state.running = true;
    try {
      await state.job.runDue();
    } catch (error) {
      this.logger.error(
        `Deadline job ${state.job.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    } finally {
      state.running = false;
      this.queueRefresh(state, 0);
    }
  }

  private unregister(name: string): void {
    const state = this.jobs.get(name);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    if (state.refreshTimer) clearTimeout(state.refreshTimer);
    this.jobs.delete(name);
    if (this.jobs.size === 0 && this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  onModuleDestroy(): void {
    for (const name of Array.from(this.jobs.keys())) this.unregister(name);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
  }
}
