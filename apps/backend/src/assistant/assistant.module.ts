import { Module } from '@nestjs/common';
import { SalonSetupModule } from '../salon-setup/salon-setup.module';
import { QueueModule } from '../queue/queue.module';
import { OwnerOpsModule } from '../owner-ops/owner-ops.module';
import { SalonsModule } from '../salons/salons.module';
import { BookingsModule } from '../bookings/bookings.module';
import { DashboardBookingsModule } from '../dashboard-bookings/dashboard-bookings.module';
import { DashboardCustomersModule } from '../dashboard-customers/dashboard-customers.module';
import { DashboardReviewsModule } from '../dashboard-reviews/dashboard-reviews.module';
import { OffersModule } from '../offers/offers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminModule } from '../admin/admin.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { AuthModule } from '../auth/auth.module';
import { EmployeeModule } from '../employee/employee.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { interpreterFromEnv } from './assistant-interpreter';
import { ASSISTANT_INTERPRETER } from './assistant-interpreter.token';
import {
  ASSISTANT_TRANSCRIBER,
  transcriberFromEnv,
} from './assistant-transcriber';

/** Action Assistant (issue #362): reuses the existing services, so their access checks and audit apply. */
@Module({
  imports: [
    SalonSetupModule,
    QueueModule,
    OwnerOpsModule,
    SalonsModule,
    BookingsModule,
    DashboardBookingsModule,
    DashboardCustomersModule,
    DashboardReviewsModule,
    OffersModule,
    NotificationsModule,
    AdminModule,
    ReviewsModule,
    AuthModule,
    EmployeeModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    { provide: ASSISTANT_INTERPRETER, useFactory: interpreterFromEnv },
    { provide: ASSISTANT_TRANSCRIBER, useFactory: transcriberFromEnv },
  ],
})
export class AssistantModule {}
