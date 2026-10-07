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
  grantAdminAccessSchema,
  revokeAdminAccessSchema,
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
  type GrantAdminAccessInput,
  type RevokeAdminAccessInput,
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
import { AdminAccessManagementService } from './admin-access-management.service';

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
    private readonly access: AdminAccessManagementService,
  ) {}

  @Get(ADMIN_PATHS.overview)
  @Roles(
    Role.PLATFORM_ADMIN,
    Role.CO_FOUNDER,
    Role.HR_ADMIN,
    Role.SALES_ADMIN,
    Role.PLATFORM_VIEWER,
  )
  overview(@CurrentUser() user: AuthenticatedUser) {
    const hasOperationalRole = [
      Role.PLATFORM_ADMIN,
      Role.CO_FOUNDER,
      Role.HR_ADMIN,
      Role.SALES_ADMIN,
    ].some((role) => user.roles.includes(role));
    const readOnlyViewer =
      user.roles.includes(Role.PLATFORM_VIEWER) && !hasOperationalRole;
    return this.monitoring.getOverview({ maskPii: readOnlyViewer });
  }

  @Get(ADMIN_PATHS.verification)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  listVerification(
    @Query('status') status?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.verification.list(status, cursor, limit);
  }

  @Get(`${ADMIN_PATHS.verification}/:id`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  getVerification(@Param('id') id: string) {
    return this.verification.getOne(id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.startReview}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  startReview(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.verification.startReview(user.id, id);
  }

  @Post(`${ADMIN_PATHS.verification}/:id/${ADMIN_PATHS.decide}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
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
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
  listEmployees() {
    return this.employees.list();
  }

  @Post(ADMIN_PATHS.employees)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
  createEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createEmployeeSchema)) body: CreateEmployeeInput,
  ) {
    return this.employees.create(user.id, body);
  }

  @Post(`${ADMIN_PATHS.employees}/${ADMIN_PATHS.special}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
  createSpecialEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createSpecialEmployeeSchema))
    body: CreateSpecialEmployeeInput,
  ) {
    return this.employees.createSpecial(user.id, body);
  }

  @Patch(`${ADMIN_PATHS.employees}/:id`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
  updateEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateEmployeeSchema)) body: UpdateEmployeeInput,
  ) {
    return this.employees.update(user.id, id, body);
  }

  @Post(`${ADMIN_PATHS.employees}/:id/${ADMIN_PATHS.password}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN)
  resetEmployeePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(resetEmployeePasswordSchema))
    body: ResetEmployeePasswordInput,
  ) {
    return this.employees.resetPassword(user.id, id, body);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.overview}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN)
  crmOverview() {
    return this.crm.getOverview();
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.leads}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN)
  crmLeads(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.crm.listLeads(employeeId, status);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.visits}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN)
  crmVisits(@Query('employeeId') employeeId?: string) {
    return this.crm.listVisits(employeeId);
  }

  @Get(`${ADMIN_PATHS.crm}/${ADMIN_PATHS.followUps}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.HR_ADMIN, Role.SALES_ADMIN)
  crmFollowUps(
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
  ) {
    return this.crm.listFollowUps(employeeId, status);
  }

  @Get(ADMIN_PATHS.access)
  @Roles(Role.PLATFORM_ADMIN)
  listAdminAccess() {
    return this.access.list();
  }

  @Post(ADMIN_PATHS.access)
  @Roles(Role.PLATFORM_ADMIN)
  grantAdminAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(grantAdminAccessSchema))
    body: GrantAdminAccessInput,
  ) {
    return this.access.grant(user.id, body.email, body.role);
  }

  @Post(`${ADMIN_PATHS.access}/:userId/${ADMIN_PATHS.revoke}`)
  @Roles(Role.PLATFORM_ADMIN)
  revokeAdminAccess(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(revokeAdminAccessSchema))
    body: RevokeAdminAccessInput,
  ) {
    return this.access.revoke(user.id, userId, body.role);
  }

  @Delete(`${ADMIN_PATHS.shops}/:id`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  deleteShop(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salonManagement.deleteSalon(user.id, id);
  }

  @Patch(`${ADMIN_PATHS.shops}/:id/${ADMIN_PATHS.status}`)
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  updateShopStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSalonStatusSchema))
    body: UpdateSalonStatusInput,
  ) {
    return this.activation.updateStatusAsAdmin(user.id, id, body);
  }
}
