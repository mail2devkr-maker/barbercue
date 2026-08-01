import { SetMetadata } from '@nestjs/common';
import type { Role } from '@barbercue/shared';

export const ROLES_KEY = 'roles';

/** Restricts an endpoint (already behind JwtAuthGuard) to one or more roles — enforced by RolesGuard. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
