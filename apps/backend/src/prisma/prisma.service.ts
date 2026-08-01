import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Deliberately does not eagerly $connect() on module init. Prisma Client connects lazily on its
// first query by default; forcing an eager connect here would crash the entire application at
// boot whenever Postgres is briefly unreachable — including for requests, like /api/v1/health,
// that never touch the database at all. DB-dependent code paths still fail correctly (and loudly)
// the moment they actually run a query against an unreachable database.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    this.logger.log(
      'PrismaService ready (lazy connect — first query establishes the connection)',
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
