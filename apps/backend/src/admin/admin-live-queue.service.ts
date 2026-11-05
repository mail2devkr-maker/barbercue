import { Injectable } from '@nestjs/common';
import {
  ChairStatus,
  QueueEntryStatus,
  type AdminLiveQueueDto,
  type AdminLiveQueueShopDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';

const LIVE: QueueEntryStatus[] = [
  QueueEntryStatus.WAITING,
  QueueEntryStatus.CALLED,
  QueueEntryStatus.IN_SERVICE,
];
export const ADMIN_LIVE_QUEUE_MAX_SHOPS = 200;

/**
 * Platform "Live Queue Monitoring" (admin nav OPERATIONS): which shops have customers in the queue
 * right now, split into waiting / called / in service, with the longest current wait. Read-only and
 * counts-only: no customer, phone, name or token is ever read or returned.
 */
@Injectable()
export class AdminLiveQueueService {
  constructor(private readonly prisma: PrismaService) {}

  async getLiveQueue(now = new Date()): Promise<AdminLiveQueueDto> {
    const [byStatus, oldest] = await Promise.all([
      this.prisma.queueEntry.groupBy({
        by: ['salonId', 'status'],
        where: { status: { in: LIVE } },
        _count: { _all: true },
      }),
      this.prisma.queueEntry.groupBy({
        by: ['salonId'],
        where: { status: QueueEntryStatus.WAITING },
        _min: { joinedAt: true },
      }),
    ]);
    const salonIds = [...new Set(byStatus.map((r) => r.salonId))];
    const [salons, chairs] = salonIds.length
      ? await Promise.all([
          this.prisma.salon.findMany({
            where: { id: { in: salonIds } },
            select: {
              id: true,
              publicId: true,
              name: true,
              status: true,
              city: { select: { name: true } },
            },
          }),
          this.prisma.chair.groupBy({
            by: ['salonId'],
            where: { salonId: { in: salonIds }, status: ChairStatus.ACTIVE },
            _count: { _all: true },
          }),
        ])
      : [[], []];

    const rows = new Map<string, AdminLiveQueueShopDto>();
    for (const s of salons) {
      rows.set(s.id, {
        id: s.id,
        publicId: s.publicId,
        name: s.name,
        city: s.city?.name ?? null,
        status: s.status as AdminLiveQueueShopDto['status'],
        waiting: 0,
        called: 0,
        inService: 0,
        activeChairs: 0,
        oldestWaitingSince: null,
      });
    }
    for (const r of byStatus) {
      const row = rows.get(r.salonId);
      if (!row) continue;
      const n = r._count._all;
      if (r.status === QueueEntryStatus.WAITING) row.waiting += n;
      else if (r.status === QueueEntryStatus.CALLED) row.called += n;
      else if (r.status === QueueEntryStatus.IN_SERVICE) row.inService += n;
    }
    for (const r of oldest) {
      const row = rows.get(r.salonId);
      if (row && r._min.joinedAt)
        row.oldestWaitingSince = r._min.joinedAt.toISOString();
    }
    for (const r of chairs) {
      const row = rows.get(r.salonId);
      if (row) row.activeChairs = r._count._all;
    }

    const all = [...rows.values()];
    const since = (r: AdminLiveQueueShopDto) =>
      r.oldestWaitingSince
        ? Date.parse(r.oldestWaitingSince)
        : Number.POSITIVE_INFINITY;
    all.sort(
      (a, b) =>
        since(a) - since(b) ||
        b.waiting +
          b.called +
          b.inService -
          (a.waiting + a.called + a.inService) ||
        a.name.localeCompare(b.name),
    );
    return {
      generatedAt: now.toISOString(),
      totals: {
        shops: all.length,
        waiting: all.reduce((n, r) => n + r.waiting, 0),
        called: all.reduce((n, r) => n + r.called, 0),
        inService: all.reduce((n, r) => n + r.inService, 0),
      },
      shops: all.slice(0, ADMIN_LIVE_QUEUE_MAX_SHOPS),
    };
  }
}
