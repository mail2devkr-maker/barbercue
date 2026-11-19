import { CanActivate, HttpStatus, Injectable } from '@nestjs/common';
import { WorkErrorCode } from '@barbercue/shared';
import { workMarketplaceEnabled } from './work-config';
import { workError } from './work-errors';

/** Every FastQue Work route answers 404 until WORK_MARKETPLACE_ENABLED=true. */
@Injectable()
export class WorkEnabledGuard implements CanActivate {
  canActivate(): boolean {
    if (!workMarketplaceEnabled()) {
      throw workError(WorkErrorCode.MARKETPLACE_DISABLED, 'FastQue Work is not available yet.', HttpStatus.NOT_FOUND);
    }
    return true;
  }
}
