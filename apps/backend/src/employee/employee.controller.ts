import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  EMPLOYEE_PATHS,
  Role,
  createCrmFollowUpSchema,
  createCrmLeadSchema,
  createCrmVisitSchema,
  onboardCrmLeadSchema,
  updateCrmFollowUpSchema,
  updateCrmLeadSchema,
  type AuthenticatedUser,
  type CreateCrmFollowUpInput,
  type CreateCrmLeadInput,
  type CreateCrmVisitInput,
  type OnboardCrmLeadInput,
  type UpdateCrmFollowUpInput,
  type UpdateCrmLeadInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { EmployeeService } from './employee.service';

@Controller(EMPLOYEE_PATHS.employee)
@Roles(Role.FIELD_EXECUTIVE)
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get(EMPLOYEE_PATHS.me)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.employees.getProfile(user.id);
  }

  @Get(EMPLOYEE_PATHS.dashboard)
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.employees.getDashboard(user.id);
  }

  @Get(EMPLOYEE_PATHS.leads)
  listLeads(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.employees.listLeads(user.id, status);
  }

  @Post(EMPLOYEE_PATHS.leads)
  createLead(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCrmLeadSchema)) body: CreateCrmLeadInput,
  ) {
    return this.employees.createLead(user.id, body);
  }

  @Patch(`${EMPLOYEE_PATHS.leads}/:id`)
  updateLead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCrmLeadSchema)) body: UpdateCrmLeadInput,
  ) {
    return this.employees.updateLead(user.id, id, body);
  }

  @Post(`${EMPLOYEE_PATHS.leads}/:id/${EMPLOYEE_PATHS.onboard}`)
  onboardLead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(onboardCrmLeadSchema)) body: OnboardCrmLeadInput,
  ) {
    return this.employees.onboardLead(user.id, id, body);
  }

  @Get(EMPLOYEE_PATHS.visits)
  listVisits(@CurrentUser() user: AuthenticatedUser) {
    return this.employees.listVisits(user.id);
  }

  @Post(EMPLOYEE_PATHS.visits)
  createVisit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCrmVisitSchema)) body: CreateCrmVisitInput,
  ) {
    return this.employees.createVisit(user.id, body);
  }

  @Get(EMPLOYEE_PATHS.followUps)
  listFollowUps(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
  ) {
    return this.employees.listFollowUps(user.id, status);
  }

  @Post(EMPLOYEE_PATHS.followUps)
  createFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCrmFollowUpSchema))
    body: CreateCrmFollowUpInput,
  ) {
    return this.employees.createFollowUp(user.id, body);
  }

  @Patch(`${EMPLOYEE_PATHS.followUps}/:id`)
  updateFollowUp(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCrmFollowUpSchema))
    body: UpdateCrmFollowUpInput,
  ) {
    return this.employees.updateFollowUp(user.id, id, body);
  }
}
