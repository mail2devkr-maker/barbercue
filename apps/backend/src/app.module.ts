import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    // Feature modules (auth, salons, staff, chairs, bookings, queue, payments, reviews, admin)
    // are added in later phases per PROJECT_STRUCTURE.md — Phase 1 is foundation only.
  ],
})
export class AppModule {}
