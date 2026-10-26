import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { Role, type AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  OwnerTransferService,
  prepareOwnerTransferSchema,
  verifyOwnerTransferSchema,
  type PrepareOwnerTransferInput,
  type VerifyOwnerTransferInput,
} from './owner-transfer.service';

/** Platform administrators only (the global RolesGuard also requires the ADMIN session audience). */
@Controller('admin')
@Roles(Role.PLATFORM_ADMIN)
export class OwnerTransferController {
  constructor(private readonly transfers: OwnerTransferService) {}

  @Get('salons/:salonId/owner-transfers')
  list(@Param('salonId') salonId: string) {
    return this.transfers.list(salonId);
  }

  @Post('salons/:salonId/owner-transfers')
  prepare(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(prepareOwnerTransferSchema))
    body: PrepareOwnerTransferInput,
  ) {
    return this.transfers.prepare(admin.id, salonId, body);
  }

  @Post('owner-transfers/:transferId/verify')
  verify(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(verifyOwnerTransferSchema))
    body: VerifyOwnerTransferInput,
  ) {
    return this.transfers.verify(admin.id, transferId, body);
  }

  @Post('owner-transfers/:transferId/cancel')
  cancel(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('transferId') transferId: string,
  ) {
    return this.transfers.cancel(admin.id, transferId);
  }

  /** The response carries the one-time temporary password: it must never be cached by anything on the way. */
  @Post('owner-transfers/:transferId/execute')
  @Header('Cache-Control', 'no-store')
  execute(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('transferId') transferId: string,
  ) {
    return this.transfers.execute(admin.id, transferId);
  }
}
