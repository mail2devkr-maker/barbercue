import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ShopDeletionService } from './shop-deletion.service';

const totpCode = z
  .string()
  .regex(/^\d{6}$/, 'Enter the current 6-digit authenticator code.');
const requestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Give a reason of at least 10 characters.')
    .max(500),
  typedShopName: z.string().trim().min(1).max(200),
});
const approveSchema = z.object({
  totpCode,
  note: z.string().trim().max(500).optional(),
});
const rejectSchema = z.object({
  totpCode,
  note: z
    .string()
    .trim()
    .min(5, 'Explain the rejection in at least 5 characters.')
    .max(500),
});
const restoreSchema = z.object({ totpCode });

/**
 * Issue #381 recoverable shop deletion. Roles are declared PER METHOD (RolesGuard uses
 * getAllAndOverride) and every platform role here is only honoured in a TOTP-verified ADMIN session.
 * No route in this controller deletes anything: the strongest action is a reversible quarantine.
 */
@Controller('admin')
export class ShopDeletionController {
  constructor(private readonly deletions: ShopDeletionService) {}

  @Get('shops/:salonId/deletion-preview')
  @Roles(Role.CO_FOUNDER, Role.PLATFORM_ADMIN)
  preview(@Param('salonId') salonId: string) {
    return this.deletions.preview(salonId);
  }

  /** Co-Founder only: queues a request for a DIFFERENT Super Admin. Changes nothing about the shop. */
  @Post('shops/:salonId/deletion-requests')
  @Roles(Role.CO_FOUNDER)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  request(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(requestSchema))
    body: z.infer<typeof requestSchema>,
  ) {
    return this.deletions.request(actor.id, salonId, body);
  }

  @Get('shop-deletions/requests')
  @Roles(Role.PLATFORM_ADMIN)
  list(@Query('cursor') cursor?: string, @Query('status') status?: string) {
    return this.deletions.list({ cursor, status });
  }

  @Get('shop-deletions/trash')
  @Roles(Role.PLATFORM_ADMIN)
  trash(@Query('cursor') cursor?: string) {
    return this.deletions.listTrash({ cursor });
  }

  @Post('shop-deletions/requests/:id/approve')
  @Roles(Role.PLATFORM_ADMIN)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  approve(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveSchema))
    body: z.infer<typeof approveSchema>,
  ) {
    return this.deletions.approve(actor.id, id, body.totpCode, body.note);
  }

  @Post('shop-deletions/requests/:id/reject')
  @Roles(Role.PLATFORM_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reject(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectSchema))
    body: z.infer<typeof rejectSchema>,
  ) {
    return this.deletions.reject(actor.id, id, body.totpCode, body.note);
  }

  @Post('shop-deletions/trash/:salonId/restore')
  @Roles(Role.PLATFORM_ADMIN)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  restore(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(restoreSchema))
    body: z.infer<typeof restoreSchema>,
  ) {
    return this.deletions.restore(actor.id, salonId, body.totpCode);
  }
}
