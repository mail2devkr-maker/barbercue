import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminShopDeletionRequestsService } from './admin-shop-deletion-requests.service';
import { AdminSecurityAuditService } from './admin-security-audit.service';

const requestSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
const approveSchema = z.object({
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Current 6-digit authenticator code required'),
  note: z.string().trim().max(500).optional(),
});
const rejectSchema = z.object({
  note: z.string().trim().min(5).max(500),
});

@Controller('admin')
@Roles(Role.PLATFORM_ADMIN)
export class AdminSecurityController {
  constructor(
    private readonly deletions: AdminShopDeletionRequestsService,
    private readonly audit: AdminSecurityAuditService,
  ) {}

  // Method-specific CO_FOUNDER grant overrides the Super Admin class default.
  // Never deletes a shop here: only queues a request for human approval.
  @Post('shops/:salonId/deletion-requests')
  @Roles(Role.CO_FOUNDER)
  requestDeletion(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(requestSchema))
    body: z.infer<typeof requestSchema>,
  ) {
    return this.deletions.request(actor.id, salonId, body.reason);
  }

  @Get('security/deletion-requests')
  listRequests() {
    return this.deletions.list();
  }

  @Post('security/deletion-requests/:id/approve')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveSchema))
    body: z.infer<typeof approveSchema>,
  ) {
    return this.deletions.approve(actor.id, id, body.totpCode, body.note);
  }

  @Post('security/deletion-requests/:id/reject')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema))
    body: z.infer<typeof rejectSchema>,
  ) {
    return this.deletions.reject(actor.id, id, body.note);
  }

  @Get('security/audit')
  listAudit(
    @Query('actorEmail') actorEmail?: string,
    @Query('action') action?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.audit.list({ actorEmail, action, cursor });
  }
}
