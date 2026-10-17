import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ADMIN_PATHS,
  OWNER_INVITATION_PATHS,
  Role,
  acceptExistingOwnerInvitationSchema,
  acceptOwnerInvitationSchema,
  ownerAccessMutationSchema,
  ownerAccessPreviewSchema,
  type AcceptExistingOwnerInvitationInput,
  type AcceptOwnerInvitationInput,
  type AuthenticatedUser,
  type OwnerAccessMutationInput,
  type OwnerAccessPreviewInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminSalonOwnerAccessService } from './admin-salon-owner-access.service';

@Controller(
  `${ADMIN_PATHS.admin}/${ADMIN_PATHS.shops}/${ADMIN_PATHS.ownerAccess}`,
)
@Roles(Role.PLATFORM_ADMIN)
export class AdminSalonOwnerAccessController {
  constructor(private readonly ownerAccess: AdminSalonOwnerAccessService) {}

  @Get()
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('query') query?: string,
  ) {
    return this.ownerAccess.search(query ?? '', user.id);
  }

  @Post('preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ownerAccessPreviewSchema))
    body: OwnerAccessPreviewInput,
  ) {
    return this.ownerAccess.preview(body.email, user.id);
  }

  @Get(':salonId')
  getShop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.ownerAccess.getShop(salonId, user.id);
  }

  @Get(':salonId/audit')
  audit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.ownerAccess.auditHistory(salonId, user.id, cursor);
  }

  @Post(':salonId/assign')
  assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(ownerAccessMutationSchema))
    body: OwnerAccessMutationInput,
  ) {
    return this.ownerAccess.assign(user.id, salonId, body);
  }

  @Post(':salonId/invitations')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(ownerAccessMutationSchema))
    body: OwnerAccessMutationInput,
  ) {
    return this.ownerAccess.invite(user.id, salonId, body);
  }

  @Post(':salonId/invitations/:invitationId/revoke')
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.ownerAccess.revokeInvite(user.id, salonId, invitationId);
  }
}

@Controller(OWNER_INVITATION_PATHS.root)
export class OwnerInvitationAcceptanceController {
  constructor(private readonly ownerAccess: AdminSalonOwnerAccessService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(OWNER_INVITATION_PATHS.accept)
  acceptNew(
    @Body(new ZodValidationPipe(acceptOwnerInvitationSchema))
    body: AcceptOwnerInvitationInput,
  ) {
    return this.ownerAccess.acceptNew(body.token, body.password);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(OWNER_INVITATION_PATHS.acceptExisting)
  acceptExisting(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(acceptExistingOwnerInvitationSchema))
    body: AcceptExistingOwnerInvitationInput,
  ) {
    return this.ownerAccess.acceptExisting(body.token, user.id);
  }
}
