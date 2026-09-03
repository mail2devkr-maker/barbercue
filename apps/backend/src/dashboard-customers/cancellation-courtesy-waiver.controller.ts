import { Controller, Param, Post } from '@nestjs/common';
import { DASHBOARD_PATHS, Role, type AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CancellationCourtesyWaiverService } from './cancellation-courtesy-waiver.service';

@Controller(DASHBOARD_PATHS.dashboard)
@Roles(Role.SALON_OWNER)
export class CancellationCourtesyWaiverController {
  constructor(private readonly courtesy: CancellationCourtesyWaiverService) {}

  @Post(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.ledger}/:ledgerEntryId/cancellation-courtesy/waive`,
  )
  waive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    return this.courtesy.waive(user.id, salonId, customerId, ledgerEntryId);
  }

  @Post(
    `${DASHBOARD_PATHS.salons}/:salonId/${DASHBOARD_PATHS.customers}/:customerId/${DASHBOARD_PATHS.ledger}/:ledgerEntryId/cancellation-courtesy/restore`,
  )
  restore(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('customerId') customerId: string,
    @Param('ledgerEntryId') ledgerEntryId: string,
  ) {
    return this.courtesy.restore(user.id, salonId, customerId, ledgerEntryId);
  }
}
