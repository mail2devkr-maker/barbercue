import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  DASHBOARD_PATHS,
  PERMANENT_DELETION_PATHS,
  Role,
  permanentDeletionConfirmSchema,
  type AuthenticatedUser,
  type PermanentDeletionConfirmInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PermanentDeletionService } from './permanent-deletion.service';

const SALON_SCOPE = `${DASHBOARD_PATHS.dashboard}/${DASHBOARD_PATHS.salons}/:salonId`;
// Deliberate actions: a few per minute is plenty, and it blunts token guessing.
const DELETION_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

/**
 * Issue #378: permanent deletion of one chair or one staff roster record. Owner (or authorized
 * platform admin) only: the role here is the outer gate; the service re-checks ownership of THIS
 * shop at preview and again inside the confirmation transaction.
 */
@Controller()
@Roles(Role.SALON_OWNER, Role.PLATFORM_ADMIN)
export class PermanentDeletionController {
  constructor(private readonly deletion: PermanentDeletionService) {}

  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.chairs}/:chairId/${PERMANENT_DELETION_PATHS.preview}`,
  )
  @HttpCode(200)
  @Throttle(DELETION_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  previewChair(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
  ) {
    return this.deletion.previewChair(user.id, salonId, chairId);
  }

  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.chairs}/:chairId/${PERMANENT_DELETION_PATHS.confirm}`,
  )
  @HttpCode(200)
  @Throttle(DELETION_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  confirmChair(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('chairId') chairId: string,
    @Body(new ZodValidationPipe(permanentDeletionConfirmSchema))
    body: PermanentDeletionConfirmInput,
  ) {
    return this.deletion.confirmChair(user.id, salonId, chairId, body);
  }

  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId/${PERMANENT_DELETION_PATHS.preview}`,
  )
  @HttpCode(200)
  @Throttle(DELETION_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  previewStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
  ) {
    return this.deletion.previewStaff(user.id, salonId, staffId);
  }

  @Post(
    `${SALON_SCOPE}/${DASHBOARD_PATHS.staff}/:staffId/${PERMANENT_DELETION_PATHS.confirm}`,
  )
  @HttpCode(200)
  @Throttle(DELETION_THROTTLE)
  @Header('Cache-Control', 'private, no-store')
  confirmStaff(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('staffId') staffId: string,
    @Body(new ZodValidationPipe(permanentDeletionConfirmSchema))
    body: PermanentDeletionConfirmInput,
  ) {
    return this.deletion.confirmStaff(user.id, salonId, staffId, body);
  }
}
