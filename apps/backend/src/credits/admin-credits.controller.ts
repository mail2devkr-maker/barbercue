import { Body, Controller, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  ADMIN_CREDITS_PATHS,
  BookingErrorCode,
  Role,
  grantPromotionalCreditsSchema,
  type AuthenticatedUser,
  type GrantPromotionalCreditsInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { CustomerCreditsService } from './customer-credits.service';

/**
 * FastQue Credits / Wallet V1 — the ONLY route that can put spendable credit into a customer's
 * wallet (besides an automatic redemption restoration on cancellation). PLATFORM_ADMIN-only at
 * both the class-level @Roles guard AND by living under `admin/...` rather than `credits/...` —
 * two independent signals a reviewer or future maintainer can't miss, unlike
 * CustomerCreditsController (customer-facing balance/history reads only) a few files over.
 *
 * @Idempotent() requires an Idempotency-Key header the same way booking creation does; that same
 * header value is what gets persisted onto the created CustomerCreditTransaction row (never a
 * separate body field an admin client could accidentally send different from the header) — see
 * CustomerCreditsService.grantPromotionalCredits's own doc comment for the double idempotency
 * protection this gives (the generic request-cache interceptor, plus a real unique DB constraint).
 */
@Controller(`${ADMIN_CREDITS_PATHS.admin}/${ADMIN_CREDITS_PATHS.credits}`)
@Roles(Role.PLATFORM_ADMIN)
export class AdminCreditsController {
  constructor(private readonly credits: CustomerCreditsService) {}

  @Post(ADMIN_CREDITS_PATHS.grant)
  @Idempotent()
  async grant(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(grantPromotionalCreditsSchema))
    body: GrantPromotionalCreditsInput,
    @Req() req: Request,
  ) {
    const idempotencyKey = req.header('Idempotency-Key');
    if (!idempotencyKey) {
      // Unreachable in practice — IdempotencyInterceptor already rejects a missing header before
      // this handler runs — but this method never persists a grant without one regardless of how
      // it's invoked, so the check is asserted here too rather than trusted implicitly.
      throw new AppException(
        BookingErrorCode.IDEMPOTENCY_KEY_REQUIRED,
        'An Idempotency-Key header is required for this request.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.credits.grantPromotionalCredits(user.id, idempotencyKey, body);
  }
}
