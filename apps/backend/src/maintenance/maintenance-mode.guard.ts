import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpStatus,
} from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { MaintenanceModeService } from './maintenance-mode.service';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(private readonly maintenanceMode: MaintenanceModeService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.maintenanceMode.isEnabled()) return true;
    // This guard covers HTTP mutations. WebSocket events are read-only today and use the Prisma
    // middleware barrier if a future handler attempts a database write.
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<{ method?: string }>();
    const method = request.method?.toUpperCase();
    if (method && SAFE_HTTP_METHODS.has(method)) return true;

    throw new AppException(
      'MAINTENANCE_MODE',
      this.maintenanceMode.getStatus().message ??
        'FastQue is under maintenance.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
