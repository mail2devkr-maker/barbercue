import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { SalonsModule } from './salons/salons.module';
import { BookingsModule } from './bookings/bookings.module';
import { SalonAccessModule } from './common/salon-access/salon-access.module';
import { RealtimeModule } from './realtime/realtime.module';
import { QueueModule } from './queue/queue.module';
import { StyleAdvisorModule } from './style-advisor/style-advisor.module';
import { PremiumModule } from './premium/premium.module';
import { PublicQueueModule } from './public-queue/public-queue.module';
import { SalonSetupModule } from './salon-setup/salon-setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
    PrismaModule,
    SalonAccessModule,
    HealthModule,
    AuthModule,
    SalonsModule,
    BookingsModule,
    RealtimeModule,
    QueueModule,
    PremiumModule,
    StyleAdvisorModule,
    PublicQueueModule,
    SalonSetupModule,
    // Feature modules (staff/chair roster CRUD, payments, reviews, admin) are added in later
    // phases per PROJECT_STRUCTURE.md.
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Default-deny: every route requires a valid access token unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Runs after JwtAuthGuard; enforces @Roles() where present.
    { provide: APP_GUARD, useClass: RolesGuard },
    // No-ops on any route not marked @Idempotent() — see IdempotencyInterceptor's own docs.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class AppModule {}
