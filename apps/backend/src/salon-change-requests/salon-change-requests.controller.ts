import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Role, type AuthenticatedUser } from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  SalonChangeRequestsService,
  createSalonChangeRequestSchema,
  decideSalonChangeRequestSchema,
  type CreateSalonChangeRequestInput,
  type DecideSalonChangeRequestInput,
} from './salon-change-requests.service';

/** Employee side: suggest a correction for a shop the employee onboarded. Never writes to the shop itself. */
@Controller('employee/leads/:leadId/shop/change-requests')
@Roles(Role.FIELD_EXECUTIVE)
export class EmployeeSalonChangeRequestsController {
  constructor(private readonly requests: SalonChangeRequestsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
  ) {
    return this.requests.listForEmployee(user.id, leadId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
    @Body(new ZodValidationPipe(createSalonChangeRequestSchema))
    body: CreateSalonChangeRequestInput,
  ) {
    return this.requests.createForEmployee(user.id, leadId, body);
  }

  @Post(':requestId/withdraw')
  withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('leadId') leadId: string,
    @Param('requestId') requestId: string,
  ) {
    return this.requests.withdrawForEmployee(user.id, leadId, requestId);
  }
}

/** Owner side: the shop's owner decides. Approval is the only way a suggestion reaches the public shop. */
@Controller('dashboard/salons/:salonId/change-requests')
@Roles(Role.SALON_OWNER)
export class OwnerSalonChangeRequestsController {
  constructor(private readonly requests: SalonChangeRequestsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
  ) {
    return this.requests.listForOwner(user.id, salonId);
  }

  @Post(':requestId/decision')
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Param('requestId') requestId: string,
    @Body(new ZodValidationPipe(decideSalonChangeRequestSchema))
    body: DecideSalonChangeRequestInput,
  ) {
    return this.requests.decide(user.id, salonId, requestId, body);
  }
}
