import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  PREMIUM_PATHS,
  PremiumErrorCode,
  Role,
  devActivatePremiumSchema,
  type AuthenticatedUser,
  type DevActivatePremiumInput,
} from '@barbercue/shared';
import { AppException } from '../common/exceptions/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PremiumPlansService } from './premium-plans.service';
import { PremiumEntitlementService } from './premium-entitlement.service';
import { AiCreditService } from './ai-credit.service';

@Controller(PREMIUM_PATHS.premium)
export class PremiumController {
  constructor(
    private readonly plans: PremiumPlansService,
    private readonly entitlement: PremiumEntitlementService,
    private readonly aiCredits: AiCreditService,
  ) {}

  // Public: plan pricing is marketing content, not per-customer data — same reasoning as
  // discovery endpoints being @Public().
  @Public()
  @Get(PREMIUM_PATHS.plans)
  listPlans() {
    return this.plans.listActivePlans();
  }

  @Roles(Role.CUSTOMER)
  @Get(PREMIUM_PATHS.me)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.entitlement.getEntitlement(user.id);
  }

  @Roles(Role.CUSTOMER)
  @Get(PREMIUM_PATHS.credits)
  credits(@CurrentUser() user: AuthenticatedUser) {
    return this.aiCredits.getBalance(user.id);
  }

  // Dev/test-only: lets a real logged-in customer activate Premium for their OWN account without
  // a payment, so the feature can be exercised locally. Unreachable in production regardless of
  // who calls it or what role they hold — this check runs before anything else in the handler.
  // Never promotes an arbitrary user; still requires a valid JWT + CUSTOMER role like any other
  // customer endpoint, it just skips the (nonexistent) payment step for the caller's own account.
  @Roles(Role.CUSTOMER)
  @HttpCode(HttpStatus.OK)
  @Post(PREMIUM_PATHS.devActivate)
  async devActivate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(devActivatePremiumSchema)) body: DevActivatePremiumInput,
  ) {
    if (process.env.NODE_ENV === 'production') {
      throw new AppException(
        PremiumErrorCode.DEV_ACTIVATION_DISABLED,
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.entitlement.activateForDevelopment(user.id, body.planId);
  }
}
