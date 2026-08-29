import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

// PrismaService is @Global() — no imports needed here.
@Module({
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
