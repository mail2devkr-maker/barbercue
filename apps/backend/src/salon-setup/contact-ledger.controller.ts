import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DASHBOARD_PATHS,
  Role,
  eraseContactSchema,
  recordContactConsentsSchema,
  withdrawContactConsentSchema,
  type AuthenticatedUser,
  type ContactLedgerSummaryDto,
  type EraseContactInput,
  type EraseContactResultDto,
  type PurgeExpiredContactConsentsResultDto,
  type RecordContactConsentsInput,
  type RecordContactConsentsResultDto,
  type WithdrawContactConsentInput,
  type WithdrawContactConsentResultDto,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ContactLedgerService } from './contact-ledger.service';

const WRITE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

/** Owner-facing consent ledger. Records evidence and honours opt-outs; it never sends anything. */
@Controller(
  `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.contacts}/consents`,
)
@Roles(Role.SALON_OWNER)
export class ContactLedgerController {
  constructor(private readonly ledger: ContactLedgerService) {}

  @Post()
  @Throttle(WRITE_LIMIT)
  record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(recordContactConsentsSchema))
    body: RecordContactConsentsInput,
  ): Promise<RecordContactConsentsResultDto> {
    return this.ledger.record(user.id, salonId, body);
  }

  @Get('summary')
  summary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ): Promise<ContactLedgerSummaryDto> {
    return this.ledger.summary(user.id, salonId);
  }

  @Post('withdraw')
  @Throttle(WRITE_LIMIT)
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(withdrawContactConsentSchema))
    body: WithdrawContactConsentInput,
  ): Promise<WithdrawContactConsentResultDto> {
    return this.ledger.withdraw(user.id, salonId, body);
  }

  @Post('erase')
  @Throttle(WRITE_LIMIT)
  erase(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Body(new ZodValidationPipe(eraseContactSchema)) body: EraseContactInput,
  ): Promise<EraseContactResultDto> {
    return this.ledger.erase(user.id, salonId, body);
  }
}

/** Platform housekeeping for the ledger. Explicitly triggered; there is no scheduler. */
@Controller('admin/contact-ledger')
@Roles(Role.PLATFORM_ADMIN)
export class ContactLedgerAdminController {
  constructor(private readonly ledger: ContactLedgerService) {}

  @Post('purge-expired')
  purgeExpired(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PurgeExpiredContactConsentsResultDto> {
    return this.ledger.purgeExpired(user.id);
  }
}
