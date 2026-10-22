import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { MaintenanceModule } from '../maintenance/maintenance.module';

// Global so every future feature module (bookings, queue, payments, ...) can inject PrismaService
// without re-importing this module everywhere — standard NestJS Prisma pattern.
@Global()
@Module({
  imports: [MaintenanceModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
