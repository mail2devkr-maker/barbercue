import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global so every future feature module (bookings, queue, payments, ...) can inject PrismaService
// without re-importing this module everywhere — standard NestJS Prisma pattern.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
