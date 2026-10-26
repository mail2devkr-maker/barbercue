import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, type AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  OwnerTransferService,
  acceptOwnerInvitationSchema,
  inviteOwnerTransferSchema,
  prepareOwnerTransferSchema,
  verifyOwnerTransferSchema,
  type AcceptOwnerInvitationInput,
  type InviteOwnerTransferInput,
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

  /** Sends (or after expiry re-sends) the single-use invitation. The response never contains the token. */
  @Post('owner-transfers/:transferId/invite')
  @Header('Cache-Control', 'no-store')
  invite(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('transferId') transferId: string,
    @Body(new ZodValidationPipe(inviteOwnerTransferSchema))
    body: InviteOwnerTransferInput,
  ) {
    return this.transfers.invite(admin.id, transferId, body);
  }
}

const INVITATION_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Public: reached by whoever holds the emailed single-use token. Generic errors, tightly rate limited. */
@Controller('auth/owner-invitations')
export class OwnerInvitationController {
  constructor(private readonly transfers: OwnerTransferService) {}

  @Public()
  @Throttle(INVITATION_THROTTLE)
  @Get()
  @Header('Cache-Control', 'no-store')
  inspect(@Query('token') token: string) {
    return this.transfers.inspectInvitation(token ?? '');
  }

  @Public()
  @Throttle(INVITATION_THROTTLE)
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  accept(
    @Body(new ZodValidationPipe(acceptOwnerInvitationSchema))
    body: AcceptOwnerInvitationInput,
  ) {
    return this.transfers.acceptInvitation(body);
  }
}
