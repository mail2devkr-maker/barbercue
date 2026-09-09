from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one anchor in {path}, found {text.count(old)}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Prisma: durable manual/local chair occupancy with audit actors.
# ---------------------------------------------------------------------------
replace_once(
    "apps/backend/prisma/schema.prisma",
    "  creditAccount           CustomerCreditAccount?\n",
    "  creditAccount           CustomerCreditAccount?\n"
    "  manualChairOccupanciesStarted ManualChairOccupancy[] @relation(\"ManualChairOccupancyStartedBy\")\n"
    "  manualChairOccupanciesEnded   ManualChairOccupancy[] @relation(\"ManualChairOccupancyEndedBy\")\n",
)
replace_once(
    "apps/backend/prisma/schema.prisma",
    "  subsidyEntries        PlatformShopSubsidyEntry[]\n",
    "  subsidyEntries        PlatformShopSubsidyEntry[]\n"
    "  manualChairOccupancies ManualChairOccupancy[]\n",
)
replace_once(
    "apps/backend/prisma/schema.prisma",
    "  queueEntriesAssigned QueueEntry[]           @relation(\"AssignedChair\")\n\n  @@map(\"chairs\")\n}\n",
    "  queueEntriesAssigned QueueEntry[]           @relation(\"AssignedChair\")\n"
    "  manualOccupancies    ManualChairOccupancy[]\n\n"
    "  @@map(\"chairs\")\n}\n\n"
    "// A local/off-platform customer can physically occupy a chair without having a FastQue\n"
    "// QueueEntry/ServiceSession. This record is deliberately separate from Chair.status: ACTIVE /\n"
    "// INACTIVE / MAINTENANCE describes whether the chair is usable at all, not whether someone is\n"
    "// sitting in it right now. endedAt NULL means currently occupied. A partial unique index in\n"
    "// the migration enforces one active manual occupancy per chair; QueueService and\n"
    "// ManualChairOccupancyService additionally share a per-chair Postgres advisory lock so an\n"
    "// ACTIVE ServiceSession and a manual occupancy cannot win a cross-table race simultaneously.\n"
    "model ManualChairOccupancy {\n"
    "  id              String   @id @default(uuid())\n"
    "  salonId         String\n"
    "  salon           Salon    @relation(fields: [salonId], references: [id])\n"
    "  chairId         String\n"
    "  chair           Chair    @relation(fields: [chairId], references: [id])\n"
    "  startedByUserId String\n"
    "  startedBy       User     @relation(\"ManualChairOccupancyStartedBy\", fields: [startedByUserId], references: [id])\n"
    "  endedByUserId   String?\n"
    "  endedBy         User?    @relation(\"ManualChairOccupancyEndedBy\", fields: [endedByUserId], references: [id])\n"
    "  startedAt       DateTime @default(now())\n"
    "  endedAt         DateTime?\n"
    "  createdAt       DateTime @default(now())\n"
    "  updatedAt       DateTime @updatedAt\n\n"
    "  @@index([salonId, endedAt])\n"
    "  @@index([chairId, endedAt])\n"
    "  @@map(\"manual_chair_occupancies\")\n"
    "}\n",
)

migration = '''-- Manual/local chair occupancy is an operational state distinct from Chair.status.
CREATE TABLE "manual_chair_occupancies" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "chairId" TEXT NOT NULL,
  "startedByUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_chair_occupancies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_chairId_fkey"
  FOREIGN KEY ("chairId") REFERENCES "chairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_startedByUserId_fkey"
  FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_endedByUserId_fkey"
  FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "manual_chair_occupancies_salonId_endedAt_idx"
  ON "manual_chair_occupancies"("salonId", "endedAt");
CREATE INDEX "manual_chair_occupancies_chairId_endedAt_idx"
  ON "manual_chair_occupancies"("chairId", "endedAt");

-- Prisma cannot express partial unique indexes. This prevents two active manual/local occupancies
-- on the same chair. Cross-table overlap with ACTIVE service_sessions is prevented by the shared
-- per-chair advisory transaction lock in application code.
CREATE UNIQUE INDEX "manual_chair_occupancy_chair_active_uq"
  ON "manual_chair_occupancies"("chairId")
  WHERE "endedAt" IS NULL;
'''
write("apps/backend/prisma/migrations/20260909030000_add_manual_chair_occupancies/migration.sql", migration)

# ---------------------------------------------------------------------------
# Shared API contracts / paths.
# ---------------------------------------------------------------------------
replace_once(
    "packages/shared/src/constants/index.ts",
    "  cancellationPolicy: 'cancellation-policy',\n} as const;",
    "  cancellationPolicy: 'cancellation-policy',\n  // Public, read-only shop payment capability for the customer booking review/confirmation UI.\n  paymentInfo: 'payment-info',\n} as const;",
)
replace_once(
    "packages/shared/src/constants/index.ts",
    "  complete: 'complete',\n  status: 'status',",
    "  complete: 'complete',\n  // Manual/local customer chair occupancy. Never aliases Chair ACTIVE/INACTIVE.\n  chairOccupancy: 'chair-occupancy',\n  occupyLocal: 'occupy-local',\n  freeLocal: 'free-local',\n  freeAllLocal: 'free-all-local',\n  status: 'status',",
)
replace_once(
    "packages/shared/src/types/index.ts",
    "export interface ChairOptionDto {\n  id: string;\n  label: string;\n}\n",
    "export type ChairOccupancyKind = 'FREE' | 'LOCAL' | 'FASTQUE';\n\n"
    "export interface ChairOptionDto {\n"
    "  id: string;\n"
    "  label: string;\n"
    "  // Optional for wire/backward compatibility with older cached clients; current backend always\n"
    "  // populates these fields. Missing occupancy is treated as FREE by clients.\n"
    "  occupancy?: ChairOccupancyKind;\n"
    "  manualOccupancyId?: string | null;\n"
    "  activeServiceSessionId?: string | null;\n"
    "  tokenNumber?: number | null;\n"
    "  assignedStaffName?: string | null;\n"
    "}\n",
)
replace_once(
    "packages/shared/src/types/index.ts",
    "export interface SalonPaymentPolicyDto {\n  salonId: string;\n  prepaymentRequirement: PrepaymentRequirement;\n  prepaymentPercentage: number | null;\n}\n",
    "export interface SalonPaymentPolicyDto {\n  salonId: string;\n  prepaymentRequirement: PrepaymentRequirement;\n  prepaymentPercentage: number | null;\n}\n\n"
    "/** Public customer-booking payment capability. No provider secret or storage internals. */\n"
    "export interface BookingPaymentInfoDto {\n"
    "  onlinePaymentAvailable: boolean;\n"
    "  paymentMethod: 'UPI_QR';\n"
    "  paymentQrImageUrl: string | null;\n"
    "  prepaymentRequirement: PrepaymentRequirement;\n"
    "  prepaymentPercentage: number | null;\n"
    "}\n",
)

# ---------------------------------------------------------------------------
# Backend payment-info endpoint: read-only, existing QR/policy only.
# ---------------------------------------------------------------------------
payment_service = '''import { Injectable } from '@nestjs/common';
import { PrepaymentRequirement, type BookingPaymentInfoDto } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityService } from './availability.service';

@Injectable()
export class BookingPaymentInfoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  async get(salonId: string): Promise<BookingPaymentInfoDto> {
    await this.availability.getSalonOrThrow(salonId);
    const policy = await this.prisma.salonPaymentPolicy.findUnique({ where: { salonId } });
    return {
      onlinePaymentAvailable: Boolean(policy?.paymentQrImageUrl),
      paymentMethod: 'UPI_QR',
      paymentQrImageUrl: policy?.paymentQrImageUrl ?? null,
      prepaymentRequirement: policy?.prepaymentRequirement ?? PrepaymentRequirement.NONE,
      prepaymentPercentage: policy?.prepaymentPercentage ?? null,
    };
  }
}
'''
write("apps/backend/src/bookings/booking-payment-info.service.ts", payment_service)
replace_once(
    "apps/backend/src/bookings/booking-info.controller.ts",
    "import { CancellationPolicyService } from './cancellation-policy.service';\n",
    "import { CancellationPolicyService } from './cancellation-policy.service';\nimport { BookingPaymentInfoService } from './booking-payment-info.service';\n",
)
replace_once(
    "apps/backend/src/bookings/booking-info.controller.ts",
    "    private readonly cancellationPolicyService: CancellationPolicyService,\n  ) {}",
    "    private readonly cancellationPolicyService: CancellationPolicyService,\n    private readonly paymentInfoService: BookingPaymentInfoService,\n  ) {}",
)
replace_once(
    "apps/backend/src/bookings/booking-info.controller.ts",
    "  @Public()\n  @Get('recent-activity')",
    "  @Public()\n  @Get('payment-info')\n  getPaymentInfo(@Param('salonId') salonId: string) {\n    return this.paymentInfoService.get(salonId);\n  }\n\n  @Public()\n  @Get('recent-activity')",
)
replace_once(
    "apps/backend/src/bookings/bookings.module.ts",
    "import { BookingNoShowService } from './booking-no-show.service';\n",
    "import { BookingNoShowService } from './booking-no-show.service';\nimport { BookingPaymentInfoService } from './booking-payment-info.service';\n",
)
replace_once(
    "apps/backend/src/bookings/bookings.module.ts",
    "    BookingNoShowService,\n  ],",
    "    BookingNoShowService,\n    BookingPaymentInfoService,\n  ],",
)

# ---------------------------------------------------------------------------
# Manual chair occupancy service/controller.
# ---------------------------------------------------------------------------
manual_service = '''import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ChairStatus, QueueErrorCode } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/exceptions/app.exception';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { QueueService } from './queue.service';

const TRANSACTION_OPTIONS = { timeout: 15_000 };

@Injectable()
export class ManualChairOccupancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salonAccess: SalonAccessService,
    private readonly queue: QueueService,
  ) {}

  async occupyLocal(userId: string, salonId: string, chairId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockChair(tx, chairId);
      const chair = await tx.chair.findFirst({ where: { id: chairId, salonId } });
      if (!chair) throw new AppException(QueueErrorCode.CHAIR_NOT_FOUND, 'Chair not found.', HttpStatus.NOT_FOUND);
      if (chair.status !== ChairStatus.ACTIVE) {
        throw new AppException(QueueErrorCode.CHAIR_INACTIVE, 'This chair is not active.', HttpStatus.CONFLICT);
      }
      const [session, existing] = await Promise.all([
        tx.serviceSession.findFirst({ where: { chairId, status: 'ACTIVE' }, select: { id: true } }),
        tx.manualChairOccupancy.findFirst({ where: { chairId, endedAt: null }, select: { id: true } }),
      ]);
      if (session || existing) {
        throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is already occupied.', HttpStatus.CONFLICT);
      }
      const created = await tx.manualChairOccupancy.create({
        data: { salonId, chairId, startedByUserId: userId },
        select: { id: true, chairId: true, startedAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIR_OCCUPIED',
          entityType: 'ManualChairOccupancy',
          entityId: created.id,
          metadata: { salonId, chairId },
        },
      });
      return created;
    }, TRANSACTION_OPTIONS);
    await this.queue.onChairOccupancyChanged(salonId);
    return { ...result, startedAt: result.startedAt.toISOString() };
  }

  async freeLocal(userId: string, salonId: string, chairId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const result = await this.prisma.$transaction(async (tx) => {
      await this.lockChair(tx, chairId);
      const chair = await tx.chair.findFirst({ where: { id: chairId, salonId }, select: { id: true } });
      if (!chair) throw new AppException(QueueErrorCode.CHAIR_NOT_FOUND, 'Chair not found.', HttpStatus.NOT_FOUND);
      const active = await tx.manualChairOccupancy.findFirst({ where: { chairId, salonId, endedAt: null } });
      if (!active) return { cleared: false, occupancyId: null as string | null };
      const endedAt = new Date();
      await tx.manualChairOccupancy.update({
        where: { id: active.id },
        data: { endedAt, endedByUserId: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIR_FREED',
          entityType: 'ManualChairOccupancy',
          entityId: active.id,
          metadata: { salonId, chairId },
        },
      });
      return { cleared: true, occupancyId: active.id };
    }, TRANSACTION_OPTIONS);
    if (result.cleared) await this.queue.onChairOccupancyChanged(salonId);
    return result;
  }

  async freeAllLocal(userId: string, salonId: string) {
    await this.salonAccess.assertAccessOrAdminAccess(userId, salonId);
    const count = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-local-chairs:${salonId}`}))`);
      const active = await tx.manualChairOccupancy.findMany({
        where: { salonId, endedAt: null },
        select: { id: true },
      });
      if (active.length === 0) return 0;
      const endedAt = new Date();
      await tx.manualChairOccupancy.updateMany({
        where: { id: { in: active.map((row) => row.id) }, endedAt: null },
        data: { endedAt, endedByUserId: userId },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'LOCAL_CHAIRS_FREED_BULK',
          entityType: 'Salon',
          entityId: salonId,
          metadata: { salonId, clearedCount: active.length },
        },
      });
      return active.length;
    }, TRANSACTION_OPTIONS);
    if (count > 0) await this.queue.onChairOccupancyChanged(salonId);
    return { clearedCount: count };
  }

  private lockChair(tx: Prisma.TransactionClient, chairId: string) {
    return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${chairId}`}))`);
  }
}
'''
write("apps/backend/src/queue/manual-chair-occupancy.service.ts", manual_service)

manual_controller = '''import { Controller, Param, Post } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ManualChairOccupancyService } from './manual-chair-occupancy.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_STAFF, Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class ManualChairOccupancyController {
  constructor(private readonly occupancy: ManualChairOccupancyService) {}

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/:chairId/${DASHBOARD_PATHS.occupyLocal}`)
  occupyLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
  ) {
    return this.occupancy.occupyLocal(user.id, salonId, chairId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/:chairId/${DASHBOARD_PATHS.freeLocal}`)
  freeLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
  ) {
    return this.occupancy.freeLocal(user.id, salonId, chairId);
  }

  @Post(`${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.chairOccupancy}/${DASHBOARD_PATHS.freeAllLocal}`)
  freeAllLocal(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.occupancy.freeAllLocal(user.id, salonId);
  }
}
'''
write("apps/backend/src/queue/manual-chair-occupancy.controller.ts", manual_controller)
replace_once(
    "apps/backend/src/queue/queue.module.ts",
    "import { QueueEntryExpiryService } from './queue-entry-expiry.service';\n",
    "import { QueueEntryExpiryService } from './queue-entry-expiry.service';\n"
    "import { ManualChairOccupancyController } from './manual-chair-occupancy.controller';\n"
    "import { ManualChairOccupancyService } from './manual-chair-occupancy.service';\n",
)
replace_once(
    "apps/backend/src/queue/queue.module.ts",
    "    DashboardQueueController,\n  ],",
    "    DashboardQueueController,\n    ManualChairOccupancyController,\n  ],",
)
replace_once(
    "apps/backend/src/queue/queue.module.ts",
    "  providers: [QueueService, StaffStatusService, QueueEntryExpiryService],",
    "  providers: [QueueService, StaffStatusService, QueueEntryExpiryService, ManualChairOccupancyService],",
)

# ---------------------------------------------------------------------------
# QueueService: manual occupancy becomes part of operational capacity and chair availability.
# ---------------------------------------------------------------------------
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    const [staffCount, chairCount, avgDuration, activeSessions] =\n      await Promise.all([",
    "    const [staffCount, chairCount, manualOccupiedCount, avgDuration, activeSessions] =\n      await Promise.all([",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "        this.prisma.chair.count({\n          where: { salonId, status: ChairStatus.ACTIVE },\n        }),\n        this.prisma.service.aggregate({",
    "        this.prisma.chair.count({\n          where: { salonId, status: ChairStatus.ACTIVE },\n        }),\n"
    "        this.prisma.manualChairOccupancy.count({\n          where: { salonId, endedAt: null },\n        }),\n"
    "        this.prisma.service.aggregate({",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    const serverCount = computeSlotCapacity(staffCount, chairCount);",
    "    const serverCount = computeSlotCapacity(staffCount, Math.max(0, chairCount - manualOccupiedCount));",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    const [staffRoster, chairs, services] = await Promise.all([",
    "    const [staffRoster, chairs, services, manualOccupancies, activeChairSessions] = await Promise.all([",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "      this.prisma.service.findMany({\n        where: { salonId, isActive: true },\n        orderBy: { name: 'asc' },\n      }),\n    ]);",
    "      this.prisma.service.findMany({\n        where: { salonId, isActive: true },\n        orderBy: { name: 'asc' },\n      }),\n"
    "      this.prisma.manualChairOccupancy.findMany({\n"
    "        where: { salonId, endedAt: null },\n"
    "        select: { id: true, chairId: true },\n"
    "      }),\n"
    "      this.prisma.serviceSession.findMany({\n"
    "        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },\n"
    "        select: { id: true, chairId: true, queueEntry: { select: { tokenNumber: true } }, staff: { select: { displayName: true } } },\n"
    "      }),\n"
    "    ]);\n\n"
    "    const manualByChair = new Map(manualOccupancies.map((row) => [row.chairId, row]));\n"
    "    const fastQueByChair = new Map(activeChairSessions.map((row) => [row.chairId, row]));",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "      chairs: chairs.map((c): ChairOptionDto => ({ id: c.id, label: c.label })),",
    "      chairs: chairs.map((c): ChairOptionDto => {\n"
    "        const fastQue = fastQueByChair.get(c.id);\n"
    "        const manual = manualByChair.get(c.id);\n"
    "        return {\n"
    "          id: c.id,\n"
    "          label: c.label,\n"
    "          occupancy: fastQue ? 'FASTQUE' : manual ? 'LOCAL' : 'FREE',\n"
    "          manualOccupancyId: manual?.id ?? null,\n"
    "          activeServiceSessionId: fastQue?.id ?? null,\n"
    "          tokenNumber: fastQue?.queueEntry.tokenNumber ?? null,\n"
    "          assignedStaffName: fastQue?.staff.displayName ?? null,\n"
    "        };\n"
    "      }),",
)
# capacity summary: add manual rows and union them with FastQue sessions.
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "      activeSessions,\n      waitingCount,",
    "      activeSessions,\n      activeManualOccupancies,\n      waitingCount,",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "      this.prisma.serviceSession.findMany({\n        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },\n        select: { chairId: true, staffId: true },\n      }),\n      this.prisma.queueEntry.count({",
    "      this.prisma.serviceSession.findMany({\n        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },\n        select: { chairId: true, staffId: true },\n      }),\n"
    "      this.prisma.manualChairOccupancy.findMany({\n        where: { salonId, endedAt: null },\n        select: { chairId: true },\n      }),\n"
    "      this.prisma.queueEntry.count({",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    const busyChairIds = new Set(activeSessions.map((s) => s.chairId));",
    "    const busyChairIds = new Set([\n"
    "      ...activeSessions.map((s) => s.chairId),\n"
    "      ...activeManualOccupancies.map((s) => s.chairId),\n"
    "    ]);",
)
# assignment cross-table lock/guard.
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    await this.prisma.$transaction(async (tx) => {\n      // Claim the entry first",
    "    await this.prisma.$transaction(async (tx) => {\n"
    "      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${input.chairId}`}))`);\n"
    "      const manualOccupancy = await tx.manualChairOccupancy.findFirst({\n"
    "        where: { chairId: input.chairId, endedAt: null },\n"
    "        select: { id: true },\n"
    "      });\n"
    "      if (manualOccupancy) {\n"
    "        throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is occupied by a local customer.', HttpStatus.CONFLICT);\n"
    "      }\n"
    "      // Claim the entry first",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "      await this.prisma.$transaction(async (tx) => {\n        const sessionClaim = await tx.serviceSession.updateMany({",
    "      await this.prisma.$transaction(async (tx) => {\n"
    "        await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`fastque-chair:${chairId}`}))`);\n"
    "        const manualOccupancy = await tx.manualChairOccupancy.findFirst({ where: { chairId, endedAt: null }, select: { id: true } });\n"
    "        if (manualOccupancy) {\n"
    "          throw new AppException(QueueErrorCode.CHAIR_ALREADY_OCCUPIED, 'This chair is occupied by a local customer.', HttpStatus.CONFLICT);\n"
    "        }\n"
    "        const sessionClaim = await tx.serviceSession.updateMany({",
)
# ETA logic: active manual chairs reduce usable server count.
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "    const activeSessions = await this.prisma.serviceSession.findMany({\n      where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },\n      select: {\n        startedAt: true,\n        service: { select: { durationMinutes: true } },\n      },\n    });\n    const activeRemaining = this.averageRemainingMinutes(activeSessions);",
    "    const [activeSessions, manualOccupiedCount, activeChairCount] = await Promise.all([\n"
    "      this.prisma.serviceSession.findMany({\n"
    "        where: { status: ServiceSessionStatus.ACTIVE, chair: { salonId } },\n"
    "        select: { startedAt: true, service: { select: { durationMinutes: true } } },\n"
    "      }),\n"
    "      this.prisma.manualChairOccupancy.count({ where: { salonId, endedAt: null } }),\n"
    "      this.prisma.chair.count({ where: { salonId, status: ChairStatus.ACTIVE } }),\n"
    "    ]);\n"
    "    const activeRemaining = this.averageRemainingMinutes(activeSessions);\n"
    "    const availableOperationalChairs = Math.max(0, activeChairCount - manualOccupiedCount);",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "        serverCount = await this.availability.getSlotCapacity(\n          this.prisma,\n          salonId,\n          entry.serviceId,\n        );",
    "        const configuredCapacity = await this.availability.getSlotCapacity(\n          this.prisma,\n          salonId,\n          entry.serviceId,\n        );\n"
    "        serverCount = Math.min(configuredCapacity, availableOperationalChairs);",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "        const [staffCount, chairCount] = await Promise.all([\n          this.prisma.salonStaff.count({\n            where: { salonId, status: StaffMemberStatus.ACTIVE },\n          }),\n          this.prisma.chair.count({\n            where: { salonId, status: ChairStatus.ACTIVE },\n          }),\n        ]);\n        serverCount = computeSlotCapacity(staffCount, chairCount);",
    "        const staffCount = await this.prisma.salonStaff.count({\n          where: { salonId, status: StaffMemberStatus.ACTIVE },\n        });\n"
    "        serverCount = computeSlotCapacity(staffCount, availableOperationalChairs);",
)
replace_once(
    "apps/backend/src/queue/queue.service.ts",
    "  // ---------- Shared internals ----------",
    "  /** Recompute wait estimates + notify all owner/staff clients after a local chair changes. */\n"
    "  async onChairOccupancyChanged(salonId: string): Promise<void> {\n"
    "    await this.recomputeEtas(salonId);\n"
    "    this.realtime.emitQueueUpdated(salonId);\n"
    "  }\n\n"
    "  // ---------- Shared internals ----------",
)

# ---------------------------------------------------------------------------
# Web queue chair controls (reuses existing layout classes; no CSS dependency).
# ---------------------------------------------------------------------------
replace_once(
    "apps/web/components/queue/DashboardQueueView.tsx",
    "  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);",
    "  const [staffBusyId, setStaffBusyId] = useState<string | null>(null);\n"
    "  const [chairBusyId, setChairBusyId] = useState<string | null>(null);",
)
replace_once(
    "apps/web/components/queue/DashboardQueueView.tsx",
    "  async function handleToggleStaffStatus(staff: StaffStatusDto) {",
    "  async function handleLocalChair(chair: ChairOptionDto, occupy: boolean) {\n"
    "    setChairBusyId(chair.id);\n"
    "    setError(null);\n"
    "    try {\n"
    "      const action = occupy ? DASHBOARD_PATHS.occupyLocal : DASHBOARD_PATHS.freeLocal;\n"
    "      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairOccupancy}/${chair.id}/${action}`, { method: \"POST\" });\n"
    "      await refetch();\n"
    "    } catch (err) {\n"
    "      setError(err instanceof ApiError ? err.message : \"Could not update this chair.\");\n"
    "    } finally {\n"
    "      setChairBusyId(null);\n"
    "    }\n"
    "  }\n\n"
    "  async function handleFreeAllLocalChairs() {\n"
    "    setChairBusyId('all-local');\n"
    "    setError(null);\n"
    "    try {\n"
    "      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairOccupancy}/${DASHBOARD_PATHS.freeAllLocal}`, { method: \"POST\" });\n"
    "      await refetch();\n"
    "    } catch (err) {\n"
    "      setError(err instanceof ApiError ? err.message : \"Could not free local chairs.\");\n"
    "    } finally {\n"
    "      setChairBusyId(null);\n"
    "    }\n"
    "  }\n\n"
    "  async function handleToggleStaffStatus(staff: StaffStatusDto) {",
)
replace_once(
    "apps/web/components/queue/DashboardQueueView.tsx",
    "      <section className={styles.dashSection}>\n        <h2 className={styles.dashHeading}>Live queue</h2>",
    "      <section className={styles.dashSection}>\n"
    "        <div style={{ display: \"flex\", justifyContent: \"space-between\", alignItems: \"center\", gap: 8 }}>\n"
    "          <h2 className={styles.dashHeading}>Chair status</h2>\n"
    "          {data.chairs.some((chair) => chair.occupancy === 'LOCAL') && (\n"
    "            <Button type=\"button\" variant=\"outline\" onClick={() => void handleFreeAllLocalChairs()} disabled={chairBusyId !== null}>\n"
    "              Free all local chairs\n"
    "            </Button>\n"
    "          )}\n"
    "        </div>\n"
    "        <div className={styles.staffRow}>\n"
    "          {data.chairs.map((chair) => {\n"
    "            const occupancy = chair.occupancy ?? 'FREE';\n"
    "            return (\n"
    "              <div key={chair.id} className={styles.staffChip}>\n"
    "                <span className={styles.staffChipName}>{chair.label}</span>\n"
    "                <span className={styles.staffChipStatus}>{occupancy === 'FREE' ? 'FREE' : occupancy === 'LOCAL' ? 'OCCUPIED — Local customer' : `OCCUPIED — Token #${chair.tokenNumber ?? '?'}`}</span>\n"
    "                {occupancy === 'FREE' && <Button type=\"button\" variant=\"outline\" onClick={() => void handleLocalChair(chair, true)} disabled={chairBusyId !== null}>Seat local customer</Button>}\n"
    "                {occupancy === 'LOCAL' && <Button type=\"button\" variant=\"outline\" onClick={() => void handleLocalChair(chair, false)} disabled={chairBusyId !== null}>Mark free</Button>}\n"
    "                {occupancy === 'FASTQUE' && <span className={styles.entryMeta}>{chair.assignedStaffName ?? 'FastQue service'}</span>}\n"
    "              </div>\n"
    "            );\n"
    "          })}\n"
    "        </div>\n"
    "      </section>\n\n"
    "      <section className={styles.dashSection}>\n        <h2 className={styles.dashHeading}>Live queue</h2>",
)
# filter assignment/reassignment choices client-side (server remains authoritative).
replace_once(
    "apps/web/components/queue/DashboardQueueView.tsx",
    "        {chairs.map((c) => (\n          <option key={c.id} value={c.id}>",
    "        {chairs.filter((c) => (c.occupancy ?? 'FREE') === 'FREE').map((c) => (\n          <option key={c.id} value={c.id}>",
)
replace_once(
    "apps/web/components/queue/DashboardQueueView.tsx",
    "          {chairs.map((chair) => <option key={chair.id} value={chair.id}>{chair.label}</option>)}",
    "          {chairs.filter((chair) => chair.id === entry.assignedChairId || (chair.occupancy ?? 'FREE') === 'FREE').map((chair) => <option key={chair.id} value={chair.id}>{chair.label}</option>)}",
)

# ---------------------------------------------------------------------------
# Mobile queue chair controls.
# ---------------------------------------------------------------------------
replace_once(
    "apps/mobile/components/dashboard/LiveQueuePanel.tsx",
    "            {chairs.map((c) => (",
    "            {chairs.filter((c) => (c.occupancy ?? 'FREE') === 'FREE').map((c) => (",
)
replace_once(
    "apps/mobile/components/dashboard/LiveQueuePanel.tsx",
    "  const [error, setError] = useState<string | null>(null);\n\n  const load = useCallback(() => {",
    "  const [error, setError] = useState<string | null>(null);\n"
    "  const [chairBusyId, setChairBusyId] = useState<string | null>(null);\n\n"
    "  const load = useCallback(() => {",
)
replace_once(
    "apps/mobile/components/dashboard/LiveQueuePanel.tsx",
    "  if (loading) {",
    "  async function updateLocalChair(chair: ChairOptionDto, occupy: boolean) {\n"
    "    setChairBusyId(chair.id);\n"
    "    setError(null);\n"
    "    try {\n"
    "      const action = occupy ? DASHBOARD_PATHS.occupyLocal : DASHBOARD_PATHS.freeLocal;\n"
    "      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairOccupancy}/${chair.id}/${action}`, { method: 'POST' });\n"
    "      await load();\n"
    "    } catch (err) {\n"
    "      setError(err instanceof ApiError ? err.message : t.couldNotCompleteAction);\n"
    "    } finally {\n"
    "      setChairBusyId(null);\n"
    "    }\n"
    "  }\n\n"
    "  async function freeAllLocalChairs() {\n"
    "    setChairBusyId('all-local');\n"
    "    setError(null);\n"
    "    try {\n"
    "      await apiFetch(`${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/${salonId}/${DASHBOARD_PATHS.chairOccupancy}/${DASHBOARD_PATHS.freeAllLocal}`, { method: 'POST' });\n"
    "      await load();\n"
    "    } catch (err) {\n"
    "      setError(err instanceof ApiError ? err.message : t.couldNotCompleteAction);\n"
    "    } finally {\n"
    "      setChairBusyId(null);\n"
    "    }\n"
    "  }\n\n"
    "  if (loading) {",
)
replace_once(
    "apps/mobile/components/dashboard/LiveQueuePanel.tsx",
    "  if (activeEntries.length === 0) {\n    return <EmptyState title={t.queueIsEmptyTitle} message={t.queueIsEmptyHint} />;\n  }\n\n  return (\n    <>\n      {activeEntries.map((entry) => (",
    "  const chairStatus = (\n"
    "    <Card style={styles.entryCard}>\n"
    "      <View style={styles.entryHeaderRow}><Text style={styles.token}>Chair status</Text>{data.chairs.some((c) => c.occupancy === 'LOCAL') && <Button title=\"Free all local\" variant=\"outline\" onPress={() => void freeAllLocalChairs()} loading={chairBusyId === 'all-local'} />}</View>\n"
    "      {data.chairs.map((chair) => {\n"
    "        const occupancy = chair.occupancy ?? 'FREE';\n"
    "        return <View key={chair.id} style={styles.chairRow}>\n"
    "          <View style={styles.chairText}><Text style={styles.assignLabel}>{chair.label}</Text><Text style={styles.meta}>{occupancy === 'FREE' ? 'FREE' : occupancy === 'LOCAL' ? 'OCCUPIED — Local customer' : `OCCUPIED — Token #${chair.tokenNumber ?? '?'}`}</Text></View>\n"
    "          {occupancy === 'FREE' && <Button title=\"Seat local\" variant=\"outline\" onPress={() => void updateLocalChair(chair, true)} loading={chairBusyId === chair.id} />}\n"
    "          {occupancy === 'LOCAL' && <Button title=\"Mark free\" variant=\"outline\" onPress={() => void updateLocalChair(chair, false)} loading={chairBusyId === chair.id} />}\n"
    "        </View>;\n"
    "      })}\n"
    "    </Card>\n"
    "  );\n\n"
    "  if (activeEntries.length === 0) {\n"
    "    return <>{chairStatus}<EmptyState title={t.queueIsEmptyTitle} message={t.queueIsEmptyHint} /></>;\n"
    "  }\n\n"
    "  return (\n    <>\n      {chairStatus}\n      {activeEntries.map((entry) => (",
)
replace_once(
    "apps/mobile/components/dashboard/LiveQueuePanel.tsx",
    "  assignPanel: { marginTop: space[3] },",
    "  assignPanel: { marginTop: space[3] },\n"
    "  chairRow: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2], borderTopWidth: 1, borderTopColor: color.border },\n"
    "  chairText: { flex: 1 },",
)

# ---------------------------------------------------------------------------
# Payment UI: visible UPI/QR option before and after booking, honest verification state.
# ---------------------------------------------------------------------------
# Web imports/state/fetch.
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "  type BookingDetailDto,\n  type CancellationPolicyDto,",
    "  type BookingDetailDto,\n  type BookingPaymentInfoDto,\n  type CancellationPolicyDto,",
)
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);",
    "  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);\n"
    "  const [paymentInfo, setPaymentInfo] = useState<BookingPaymentInfoDto | null>(null);\n"
    "  const [paymentInfoError, setPaymentInfoError] = useState(false);",
)
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "  // FastQue Credits / Wallet V1 — only fetched once signed in; an anonymous visitor has no wallet.\n  useEffect(() => {",
    "  useEffect(() => {\n"
    "    let cancelled = false;\n"
    "    setPaymentInfoError(false);\n"
    "    apiFetch<BookingPaymentInfoDto>(`${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.paymentInfo}`)\n"
    "      .then((info) => { if (!cancelled) setPaymentInfo(info); })\n"
    "      .catch(() => { if (!cancelled) setPaymentInfoError(true); });\n"
    "    return () => { cancelled = true; };\n"
    "  }, [salonId]);\n\n"
    "  // FastQue Credits / Wallet V1 — only fetched once signed in; an anonymous visitor has no wallet.\n  useEffect(() => {",
)
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (",
    "          {!cancelled && paymentInfo?.onlinePaymentAvailable && (\n"
    "            <div className={styles.summaryLine} style={{ display: \"flex\", flexDirection: \"column\", gap: 8, padding: 12, border: \"1px solid var(--bc-border)\", borderRadius: 12 }}>\n"
    "              <strong>Pay Online with UPI</strong>\n"
    "              <span>Amount payable: {formatMoney(booking.payableAmount, currency, countryCode)}</span>\n"
    "              {paymentInfo.paymentQrImageUrl && <img src={paymentInfo.paymentQrImageUrl} alt=\"Shop UPI payment QR\" width={220} height={220} style={{ maxWidth: \"100%\", objectFit: \"contain\" }} />}\n"
    "              <span>Scan this shop QR with your UPI app. Opening/scanning the QR does not make FastQue mark payment as paid; settlement is not automatically verified in V1.</span>\n"
    "            </div>\n"
    "          )}\n"
    "          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (",
)
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "          {submitError && <p className={styles.errorText}>{submitError}</p>}",
    "          <div className={styles.summaryLine} style={{ display: \"flex\", flexDirection: \"column\", gap: 8, padding: 12, border: \"1px solid var(--bc-border)\", borderRadius: 12 }}>\n"
    "            <strong>Payment</strong>\n"
    "            <span>Pay Online with UPI</span>\n"
    "            {paymentInfo?.onlinePaymentAvailable ? (\n"
    "              <>\n"
    "                <span>Shop payment QR is ready. Final amount is confirmed by the server after any FastQue Credits are applied.</span>\n"
    "                {paymentInfo.paymentQrImageUrl && <img src={paymentInfo.paymentQrImageUrl} alt=\"Shop UPI payment QR\" width={180} height={180} style={{ maxWidth: \"100%\", objectFit: \"contain\" }} />}\n"
    "              </>\n"
    "            ) : paymentInfoError ? (\n"
    "              <span>Payment information could not be loaded. FastQue will still verify the shop payment setup when you confirm.</span>\n"
    "            ) : paymentInfo ? (\n"
    "              <span className={styles.errorText}>Online booking is unavailable because this shop has not configured online payment yet.</span>\n"
    "            ) : (\n"
    "              <span>Checking shop payment setup…</span>\n"
    "            )}\n"
    "          </div>\n"
    "          {submitError && <p className={styles.errorText}>{submitError}</p>}",
)
replace_once(
    "apps/web/components/booking/BookingFlow.tsx",
    "              <Button type=\"button\" variant=\"primary\" onClick={() => void handleConfirmBooking()} disabled={submitting}>",
    "              <Button type=\"button\" variant=\"primary\" onClick={() => void handleConfirmBooking()} disabled={submitting || (paymentInfo !== null && !paymentInfo.onlinePaymentAvailable)}>",
)

# Mobile imports/state/fetch/render.
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "import { Pressable, StyleSheet, Text, View } from 'react-native';",
    "import { Image, Pressable, StyleSheet, Text, View } from 'react-native';",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "  BookingDetailDto,\n  CancellationPolicyDto,",
    "  BookingDetailDto,\n  BookingPaymentInfoDto,\n  CancellationPolicyDto,",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);",
    "  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicyDto | null>(null);\n"
    "  const [paymentInfo, setPaymentInfo] = useState<BookingPaymentInfoDto | null>(null);\n"
    "  const [paymentInfoError, setPaymentInfoError] = useState(false);",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "  useEffect(() => {\n    if (status !== 'authenticated') return;",
    "  useEffect(() => {\n"
    "    let cancelled = false;\n"
    "    setPaymentInfoError(false);\n"
    "    apiFetch<BookingPaymentInfoDto>(`${DISCOVERY_PATHS.salons}/${salonId}/booking/${SALON_BOOKING_INFO_PATHS.paymentInfo}`)\n"
    "      .then((info) => { if (!cancelled) setPaymentInfo(info); })\n"
    "      .catch(() => { if (!cancelled) setPaymentInfoError(true); });\n"
    "    return () => { cancelled = true; };\n"
    "  }, [salonId]);\n\n"
    "  useEffect(() => {\n    if (status !== 'authenticated') return;",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (",
    "          {paymentInfo?.onlinePaymentAvailable && (\n"
    "            <View style={styles.paymentBox}>\n"
    "              <Text style={styles.paymentTitle}>Pay Online with UPI</Text>\n"
    "              <Text style={styles.line}>Amount payable: {formatMoney(booking.payableAmount, null)}</Text>\n"
    "              {paymentInfo.paymentQrImageUrl && <Image source={{ uri: paymentInfo.paymentQrImageUrl }} style={styles.paymentQr} resizeMode=\"contain\" />}\n"
    "              <Text style={styles.hint}>Scan this shop QR with your UPI app. FastQue does not automatically mark the payment as paid just because the QR was opened or scanned.</Text>\n"
    "            </View>\n"
    "          )}\n"
    "          {booking.creditsRedeemedAmount !== null && booking.creditsRedeemedAmount > 0 && (",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "      {error && <InlineError message={error} />}",
    "      <Card style={styles.card}>\n"
    "        <Text style={styles.paymentTitle}>Payment</Text>\n"
    "        <Text style={styles.line}>Pay Online with UPI</Text>\n"
    "        {paymentInfo?.onlinePaymentAvailable ? (\n"
    "          <>\n"
    "            <Text style={styles.hint}>Shop payment QR is ready. The server confirms the final amount after any FastQue Credits are applied.</Text>\n"
    "            {paymentInfo.paymentQrImageUrl && <Image source={{ uri: paymentInfo.paymentQrImageUrl }} style={styles.paymentQrSmall} resizeMode=\"contain\" />}\n"
    "          </>\n"
    "        ) : paymentInfoError ? (\n"
    "          <Text style={styles.hint}>Payment information could not be loaded. FastQue will still verify the shop payment setup when you confirm.</Text>\n"
    "        ) : paymentInfo ? (\n"
    "          <Text style={styles.paymentError}>Online booking is unavailable because this shop has not configured online payment yet.</Text>\n"
    "        ) : (\n"
    "          <Text style={styles.hint}>Checking shop payment setup…</Text>\n"
    "        )}\n"
    "      </Card>\n"
    "      {error && <InlineError message={error} />}",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "        <Button title={t.confirm} onPress={() => void handleConfirm()} loading={submitting} style={styles.actionButton} />",
    "        <Button title={t.confirm} onPress={() => void handleConfirm()} loading={submitting} disabled={paymentInfo !== null && !paymentInfo.onlinePaymentAvailable} style={styles.actionButton} />",
)
replace_once(
    "apps/mobile/screens/ConfirmBookingScreen.tsx",
    "  status: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent, marginTop: space[2] },",
    "  status: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.accent, marginTop: space[2] },\n"
    "  paymentBox: { marginTop: space[3], paddingTop: space[3], borderTopWidth: 1, borderTopColor: color.border },\n"
    "  paymentTitle: { fontFamily: font.bodySemiBold, fontSize: fontSize.sm, color: color.ink, marginBottom: space[2] },\n"
    "  paymentQr: { width: 220, height: 220, alignSelf: 'center', marginVertical: space[2] },\n"
    "  paymentQrSmall: { width: 160, height: 160, alignSelf: 'center', marginVertical: space[2] },\n"
    "  paymentError: { fontFamily: font.bodyRegular, fontSize: fontSize.xs, color: color.danger, marginTop: space[1] },",
)

# ---------------------------------------------------------------------------
# Focused backend tests for core safety behavior.
# ---------------------------------------------------------------------------
manual_spec = '''import { ManualChairOccupancyService } from './manual-chair-occupancy.service';

function harness(overrides: Record<string, unknown> = {}) {
  const tx: any = {
    $executeRaw: jest.fn().mockResolvedValue(0),
    chair: { findFirst: jest.fn().mockResolvedValue({ id: 'c1', status: 'ACTIVE' }) },
    serviceSession: { findFirst: jest.fn().mockResolvedValue(null) },
    manualChairOccupancy: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'm1', chairId: 'c1', startedAt: new Date('2026-09-09T00:00:00Z') }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  const prisma: any = { $transaction: jest.fn((cb: any) => cb(tx)) };
  const access: any = { assertAccessOrAdminAccess: jest.fn().mockResolvedValue('STAFF_OR_OWNER') };
  const queue: any = { onChairOccupancyChanged: jest.fn().mockResolvedValue(undefined) };
  return { service: new ManualChairOccupancyService(prisma, access, queue), tx, prisma, access, queue };
}

describe('ManualChairOccupancyService', () => {
  it('occupies a free active chair and refreshes queue capacity', async () => {
    const h = harness();
    const result = await h.service.occupyLocal('u1', 's1', 'c1');
    expect(result.id).toBe('m1');
    expect(h.tx.manualChairOccupancy.create).toHaveBeenCalled();
    expect(h.queue.onChairOccupancyChanged).toHaveBeenCalledWith('s1');
  });

  it('rejects a chair with an active FastQue service', async () => {
    const h = harness();
    h.tx.serviceSession.findFirst.mockResolvedValue({ id: 'ss1' });
    await expect(h.service.occupyLocal('u1', 's1', 'c1')).rejects.toMatchObject({ response: expect.anything() });
    expect(h.tx.manualChairOccupancy.create).not.toHaveBeenCalled();
  });

  it('rejects a second active manual occupancy', async () => {
    const h = harness();
    h.tx.manualChairOccupancy.findFirst.mockResolvedValue({ id: 'm0' });
    await expect(h.service.occupyLocal('u1', 's1', 'c1')).rejects.toBeDefined();
    expect(h.tx.manualChairOccupancy.create).not.toHaveBeenCalled();
  });

  it('free is idempotent when no local occupancy exists', async () => {
    const h = harness();
    const result = await h.service.freeLocal('u1', 's1', 'c1');
    expect(result).toEqual({ cleared: false, occupancyId: null });
    expect(h.queue.onChairOccupancyChanged).not.toHaveBeenCalled();
  });

  it('bulk free touches manual occupancies only and audits the actor', async () => {
    const h = harness();
    h.tx.manualChairOccupancy.findMany.mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]);
    h.tx.manualChairOccupancy.updateMany.mockResolvedValue({ count: 2 });
    const result = await h.service.freeAllLocal('u1', 's1');
    expect(result).toEqual({ clearedCount: 2 });
    expect(h.tx.serviceSession.updateMany).toBeUndefined();
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: 'u1', action: 'LOCAL_CHAIRS_FREED_BULK' }) }));
  });
});
'''
write("apps/backend/src/queue/manual-chair-occupancy.service.spec.ts", manual_spec)

payment_spec = '''import { PrepaymentRequirement } from '@barbercue/shared';
import { BookingPaymentInfoService } from './booking-payment-info.service';

describe('BookingPaymentInfoService', () => {
  it('reports UPI QR available without exposing provider secrets', async () => {
    const prisma: any = { salonPaymentPolicy: { findUnique: jest.fn().mockResolvedValue({ paymentQrImageUrl: 'https://cdn.example/qr.png', prepaymentRequirement: 'NONE', prepaymentPercentage: null }) } };
    const availability: any = { getSalonOrThrow: jest.fn().mockResolvedValue({ id: 's1' }) };
    const service = new BookingPaymentInfoService(prisma, availability);
    await expect(service.get('s1')).resolves.toEqual({
      onlinePaymentAvailable: true,
      paymentMethod: 'UPI_QR',
      paymentQrImageUrl: 'https://cdn.example/qr.png',
      prepaymentRequirement: PrepaymentRequirement.NONE,
      prepaymentPercentage: null,
    });
  });

  it('reports unavailable when the shop has no QR', async () => {
    const prisma: any = { salonPaymentPolicy: { findUnique: jest.fn().mockResolvedValue(null) } };
    const availability: any = { getSalonOrThrow: jest.fn().mockResolvedValue({ id: 's1' }) };
    const service = new BookingPaymentInfoService(prisma, availability);
    const result = await service.get('s1');
    expect(result.onlinePaymentAvailable).toBe(false);
    expect(result.paymentQrImageUrl).toBeNull();
  });
});
'''
write("apps/backend/src/bookings/booking-payment-info.service.spec.ts", payment_spec)

print('Combined FastQue patch applied successfully.')
