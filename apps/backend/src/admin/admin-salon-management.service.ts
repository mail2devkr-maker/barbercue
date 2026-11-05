import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';

/**
 * Security bridge: the old one-click hard delete cannot remain exposed while
 * the owner's two-person + fresh TOTP + 30-day recovery flow is being integrated.
 * In particular, a CO_FOUNDER request must never hard-delete a whole shop.
 *
 * This endpoint deliberately has NO mutation path, even for an empty shop.
 * The replacement is tracked in #381 and must be independently certified.
 */
@Injectable()
export class AdminSalonManagementService {
  async deleteSalon(
    _actorUserId: string,
    _salonId: string,
  ): Promise<{ deleted: true }> {
    throw new AppException(
      'SHOP_DELETION_APPROVAL_REQUIRED',
      'Direct shop deletion is disabled. Shop deletion must be requested by a Co-Founder, approved with fresh Super Admin TOTP, and remain recoverable for 30 days.',
      HttpStatus.CONFLICT,
    );
  }
}
