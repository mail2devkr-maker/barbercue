import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { QueueEntryStatus, type CancellationPolicyDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { CancellationPolicyService } from '../bookings/cancellation-policy.service';
import { QueueService } from './queue.service';

/**
 * STATE_MACHINES.md: "CALLED --> NO_SHOW: customer doesn't respond within
 * queueCallResponseGraceMinutes" — documented since Phase 3C but explicitly never built
 * ("manual trigger only — no automatic sweep on queueCallResponseGraceMinutes timeout"). Until
 * this service, a customer who was called and never responded stayed CALLED forever: staff had to
 * remember to manually mark every unresponsive call as no-show, and — because
 * assertNotAlreadyInQueue() blocks a second join/check-in while any WAITING/CALLED/IN_SERVICE
 * entry exists for that customer, across every salon — that customer was locked out of joining
 * any queue anywhere until a staff member happened to notice and intervene. This is the "stale
 * token stays active" bug: the queue-side counterpart to CONFIRMED bookings never expiring to
 * NO_SHOW (see booking-no-show.service.ts).
 *
 * queueCallResponseGraceMinutes is a per-salon CancellationPolicy setting (seeded default: 3
 * minutes), not a fixed constant — same per-salon-policy-lookup pattern as
 * booking-no-show.service.ts. No charge/ledger consequence exists for a queue-level no-show
 * (queue-engine transitions in Phase 3C never carry money — only the booking-level equivalents
 * do), but STATE_MACHINES.md's audit rule covers "money OR customer-facing consequences," and
 * losing your place in line is unambiguously customer-facing, so this still writes an AuditLog
 * row for the same reason the manual staff-triggered no-show/cancel actions would if they were
 * audited (they aren't, today, per Phase 3C's own note — but this is a new *automated* system
 * decision, exactly the kind of thing worth a durable trail for debugging).
 *
 * Same claim-based sweep shape as booking-expiry.service.ts / booking-no-show.service.ts: the
 * updateMany re-checks status inside its own where clause as the durable claim, so a staff member
 * manually resolving the entry between the initial read and the write is silently skipped rather
 * than incorrectly overwritten.
 */
@Injectable()
export class QueueEntryExpiryService {
  private readonly logger = new Logger(QueueEntryExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cancellationPolicy: CancellationPolicyService,
    private readonly realtime: RealtimeGateway,
    private readonly queueService: QueueService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const count = await this.markOverdueNoShows();
    if (count > 0) this.logger.log(`Marked ${count} queue entr(y/ies) as no-show.`);
  }

  async markOverdueNoShows(): Promise<number> {
    const now = Date.now();

    // Broad candidate read: any CALLED entry. calledAt is always set once CALLED (see call()),
    // so this can't be null here. The salon-specific grace check happens per candidate below —
    // queueCallResponseGraceMinutes varies per salon.
    const candidates = await this.prisma.queueEntry.findMany({
      where: { status: QueueEntryStatus.CALLED },
      select: { id: true, salonId: true, calledAt: true },
    });

    if (candidates.length === 0) return 0;

    const policyCache = new Map<string, CancellationPolicyDto>();
    async function policyFor(
      this: QueueEntryExpiryService,
      salonId: string,
    ): Promise<CancellationPolicyDto> {
      const cached = policyCache.get(salonId);
      if (cached) return cached;
      const policy = await this.cancellationPolicy.getEffectivePolicy(salonId);
      policyCache.set(salonId, policy);
      return policy;
    }

    let markedCount = 0;
    const affectedSalons = new Set<string>();
    for (const entry of candidates) {
      const policy = await policyFor.call(this, entry.salonId);
      const graceMs = policy.queueCallResponseGraceMinutes * 60_000;
      if (!entry.calledAt || entry.calledAt.getTime() + graceMs > now) continue;

      const result = await this.prisma.$transaction(async (tx) => {
        const claim = await tx.queueEntry.updateMany({
          where: { id: entry.id, status: QueueEntryStatus.CALLED },
          data: { status: QueueEntryStatus.NO_SHOW },
        });
        if (claim.count === 0) return false;

        await tx.auditLog.create({
          data: {
            actorUserId: null,
            action: 'QUEUE_ENTRY_NO_SHOW',
            entityType: 'QueueEntry',
            entityId: entry.id,
            metadata: {
              queueCallResponseGraceMinutes: policy.queueCallResponseGraceMinutes,
            },
          },
        });
        return true;
      });

      if (result) {
        markedCount += 1;
        affectedSalons.add(entry.salonId);
        this.realtime.emitQueueEntryNoShow(entry.salonId, entry.id);
      }
    }

    for (const salonId of affectedSalons) {
      await this.queueService.recomputeEtas(salonId);
      this.realtime.emitQueueUpdated(salonId);
    }

    return markedCount;
  }
}
