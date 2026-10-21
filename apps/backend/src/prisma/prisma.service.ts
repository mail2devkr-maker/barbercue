import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MaintenanceModeService } from '../maintenance/maintenance-mode.service';

// Deliberately does not eagerly $connect() on module init. Prisma Client connects lazily on its
// first query by default; forcing an eager connect here would crash the entire application at
// boot whenever Postgres is briefly unreachable — including for requests, like /api/v1/health,
// that never touch the database at all. DB-dependent code paths still fail correctly (and loudly)
// the moment they actually run a query against an unreachable database.
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly maintenanceMode: MaintenanceModeService) {
    super();
    this.$use(async (params, next) => {
      this.maintenanceMode.assertDatabaseOperationAllowed(params.action);
      // Prisma's middleware contract types `next` as Promise<any>; returning it is required to
      // preserve the generated query result, and the operation is still bounded by Prisma's API.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return next(params);
    });
    this.logger.log(
      'PrismaService ready (lazy connect — first query establishes the connection)',
    );
  }

  // Nest closes the HTTP adapter after OnModuleDestroy and before OnApplicationShutdown.
  // Keep the pool alive until in-flight requests have drained, then disconnect it.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}
