import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ADMIN_PATHS,
  Role,
  decideVerificationSchema,
  updateSalonStatusSchema,
  type AuthenticatedUser,
  createEmployeeSchema,
  createSpecialEmployeeSchema,
  resetEmployeePasswordSchema,
  updateEmployeeSchema,
  type CreateEmployeeInput,
  type CreateSpecialEmployeeInput,
  type DecideVerificationInput,
  type ResetEmployeePasswordInput,
  type UpdateEmployeeInput,
  type UpdateSalonStatusInput,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminVerificationService } from './admin-verification.service';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { SalonActivationService } from '../salon-setup/salon-activation.service';
import { AdminEmployeeManagementService } from './admin-employee-management.service';
import { AdminCrmService } from './admin-crm.service';

/** Authentication is global; authorization is admin-role only. Monitoring routes are read-only;
 * the verification routes (Phase 18) and shop deletion are this controller's mutating surfaces —
 * always a human admin's explicit action, never an automated one. */
@Controller(ADMIN_PATHS.admin)
@Roles(Role.PLATFORM_ADMIN)
export class AdminController {
  constructor(
    private readonly monitoring: AdminMonitoringService,
    private readonly verification: AdminVerificationService,
    private readonly salonManagement: AdminSalonManagementService,
    private readonly activation: SalonActivationService,
    private readonly employees: AdminEmployeeManagementService,
    private readonly crm: AdminCrmService,
  ) {}

  @Get(ADMIN_PATHS.overview)
  overview() {
    return this.monitoring.getOverview();
  }

  @Get(ADMIN_PATHS.verification)
  listVerification(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verification.list(status, cursor, limit);
  }

  @Get(`${ADMIN_PATHS.verification}/:id`)
  getVerification(@Param('id') id: string) {
    return this.verification.getOne(id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.startReview}`)
  startReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.verification.startReview(user.id, id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.decide}`)
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(decideVerificationSchema))
    body: DecideVerificationInput,
  ) {
    return this.verification.decide(
      user.id,
      id,
      body.decision,
      body.reviewNotes,
    );
  }

  @Get(ADMIN_PATHS.employees)
  listEmployees() {
    return this.employees.list();
  }

  @Post(ADMIN_PATHS.employees)
  createEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
  ) {
    return this.employees.create(user.id, body);
  }

  @Post(`${ADMIN_PATHS.employees}/${ADMIN_PATHS.special}`)
  createSpecialEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSpecialEmployeeSchema))
    body: CreateSpecialEmployeeInput,
  ) {
    return this.employees.createSpecial(user.id, body);
  }

  @Patch(`${ADMIN_PATHS.employees}/:id`)
  updateEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
  ) {
    return this.employees.update(user.id, id, body);
  }

  @Post(`${ADMIN_PATHS.employees}/:id/${ADMIN_PATHS.password}`)
  resetEmployeePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetEmployeePasswordSchema))
    body: ResetEmployeePasswordInput,
  ) {
    return this.employees.resetPassword(user.id, id, body);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.overview}`)
  crmOverview() {
    return this.crm.getOverview();
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.leads}`)
  crmLeads(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.crm.listLeads(employeeId, status);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.visits}`)
  crmVisits(@Query('employeeId') employeeId?: string) {
    return this.crm.listVisits(employeeId);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.followUps}`)
  crmFollowUps(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.crm.listFollowUps(employeeId, status);
  }

  @Delete(`${ADMIN_PATHS.shops}/:id`)
  deleteShop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salonManagement.deleteSalon(user.id, id);
  }

  @Patch(`${ADMIN_PATHS.shops}/:id/${ADMIN_PATHS.status}`)
  updateShopStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalonStatusSchema))
    body: UpdateSalonStatusInput,
  ) {
    return this.activation.updateStatusAsAdmin(user.id, id, body);
  }
}
