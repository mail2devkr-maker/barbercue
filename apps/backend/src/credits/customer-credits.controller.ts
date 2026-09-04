import { Controller, Get, Query } from '@nestjs/common';
import { CREDITS_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CustomerCreditsService } from './customer-credits.service';

@Controller(CREDITS_PATHS.credits)
@Roles(Role.CUSTOMER)
export class CustomerCreditsController {
  constructor(private readonly credits: CustomerCreditsService) {}

  @Get(CREDITS_PATHS.balance)
  getBalance(@CurrentUser() user: AuthenticatedUser) {
    return this.credits.getBalance(user.id);
  }

  @Get(CREDITS_PATHS.history)
  getHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.credits.getHistory(
      user.id,
      cursor,
      parsedLimit && Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : undefined,
    );
  }
}
