import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  OwnerInvitationController,
  OwnerTransferController,
} from './owner-transfer.controller';
import { OwnerTransferService } from './owner-transfer.service';

@Module({
  imports: [AuthModule],
  controllers: [OwnerTransferController, OwnerInvitationController],
  providers: [OwnerTransferService],
})
export class OwnerTransferModule {}
