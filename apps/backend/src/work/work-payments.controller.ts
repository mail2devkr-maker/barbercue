import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import {
  Role,
  workSandboxPayoutSettleSchema,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkPaymentsService } from './work-payments.service';
import {
  SANDBOX_SIGNATURE_HEADER,
  SANDBOX_TIMESTAMP_HEADER,
} from './payments/work-payment-provider';

const fundingOutcomeSchema = z.object({
  outcome: z.enum(['SUCCEEDED', 'FAILED']),
});

@Controller('work')
@UseGuards(WorkEnabledGuard)
export class WorkPaymentsController {
  constructor(private readonly payments: WorkPaymentsService) {}

  /**
   * Provider webhook. Public (the provider has no user session) but every request must carry a
   * valid signature and fresh timestamp; rejected attempts are audited. Repeat deliveries of the
   * same provider event id are acknowledged and ignored.
   */
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 300 } })
  @Post('payments/webhook')
  @HttpCode(HttpStatus.OK)
  webhook(
    @Headers(SANDBOX_SIGNATURE_HEADER) signature: string | undefined,
    @Headers(SANDBOX_TIMESTAMP_HEADER) timestamp: string | undefined,
    @Body() body: unknown,
  ) {
    return this.payments.handleWebhook(
      {
        [SANDBOX_SIGNATURE_HEADER]: signature,
        [SANDBOX_TIMESTAMP_HEADER]: timestamp,
      },
      body,
    );
  }

  /** SANDBOX ONLY — 404 unless the sandbox provider is active (never in production). */
  @Post('sandbox/fundings/:fundingId/complete')
  @HttpCode(HttpStatus.OK)
  sandboxFund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fundingId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fundingOutcomeSchema))
    body: z.infer<typeof fundingOutcomeSchema>,
  ) {
    return this.payments.sandboxCompleteFunding(user.id, id, body.outcome);
  }

  /** SANDBOX ONLY — platform admins simulate the bank settling a payout. */
  @Post('sandbox/payouts/:payoutId/settle')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  sandboxSettle(
    @Param('payoutId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workSandboxPayoutSettleSchema))
    body: z.infer<typeof workSandboxPayoutSettleSchema>,
  ) {
    return this.payments.sandboxSettlePayout(
      id,
      body.outcome,
      body.failureReason,
    );
  }
}
