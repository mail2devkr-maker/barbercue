import { Controller, Get } from '@nestjs/common';
import {
  EMPLOYEE_PATHS,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { EmployeeService } from './employee.service';

@Controller(EMPLOYEE_PATHS.employee)
@Roles(Role.FIELD_EXECUTIVE)
export class EmployeeController {
  constructor(private readonly employees: EmployeeService) {}

  @Get(EMPLOYEE_PATHS.me)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.employees.getProfile(user.id);
  }
}
