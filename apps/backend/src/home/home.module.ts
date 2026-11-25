import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';
import { NotificationDeliveryModule } from '../notifications/notification-delivery.module';
import { PrismaService } from '../prisma/prisma.service';
import { StorageModule } from '../storage/storage.module';
import {
  HomeAdminController,
  HomeFieldController,
} from './home-admin.controller';
import { HomeAdminService } from './home-admin.service';
import { HomeAvailabilityService } from './home-availability.service';
import { HomeBookingService } from './home-booking.service';
import { HomeCatalogService } from './home-catalog.service';
import { HomeCoreService, addMin } from './home-core.service';
import { HomeCustomerService } from './home-customer.service';
import { HomeEnabledGuard } from './home-errors';
import { HomeProviderService } from './home-provider.service';
import { HomeQuoteService } from './home-quote.service';
import { HomeRoutingService } from './home-routing.service';
import { HomeVisitService } from './home-visit.service';
import {
  HomeCustomerController,
  HomeGuestController,
  HomeOwnerController,
  HomeProController,
  HomePublicController,
} from './home.controller';

/** Society deadlines and repeat bookings, on the existing deadline scheduler (no polling). */
@Injectable()
class HomeJobs implements OnModuleInit {
  constructor(
    private readonly deadlines: DbDeadlineSchedulerService,
    private readonly prisma: PrismaService,
    private readonly customers: HomeCustomerService,
  ) {}
  onModuleInit(): void {
    this.deadlines.register({
      name: 'home-growth',
      domain: 'home',
      nextDueAt: async () => {
        const [c, r] = await Promise.all([
          this.prisma.homeCampaign.findFirst({
            where: { status: 'OPEN' },
            orderBy: { joinBy: 'asc' },
            select: { joinBy: true },
          }),
          this.prisma.homeRecurringPlan.findFirst({
            where: { status: 'ACTIVE' },
            orderBy: { nextStart: 'asc' },
            select: { nextStart: true },
          }),
        ]);
        const d = [c?.joinBy, r ? addMin(r.nextStart, -7 * 1440) : null].filter(
          (x): x is Date => !!x,
        );
        return d.length
          ? new Date(Math.min(...d.map((x) => x.getTime())))
          : null;
      },
      runDue: async () => {
        await this.customers.closeCampaigns();
        await this.customers.runRecurring();
      },
    });
  }
}

/** FastQue Home - see docs/home/. Off by default; flags gate new business only. */
@Module({
  imports: [
    AuthModule,
    BookingsModule,
    NotificationDeliveryModule,
    StorageModule,
  ],
  controllers: [
    HomePublicController,
    HomeGuestController,
    HomeCustomerController,
    HomeProController,
    HomeOwnerController,
    HomeAdminController,
    HomeFieldController,
  ],
  providers: [
    HomeEnabledGuard,
    HomeCoreService,
    HomeRoutingService,
    HomeAvailabilityService,
    HomeCatalogService,
    HomeQuoteService,
    HomeBookingService,
    HomeVisitService,
    HomeProviderService,
    HomeCustomerService,
    HomeAdminService,
    HomeJobs,
  ],
  exports: [HomeRoutingService],
})
export class HomeModule {}
